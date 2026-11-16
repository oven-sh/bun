// Origins, URL patterns and Content Security Policy.
const path = require("node:path");

type Privileges = Record<string, boolean | undefined>;
const schemes = new Map<string, Privileges>();
const privilegesOf = (protocol: string): Privileges => schemes.$get(protocol) ?? {};

function originOf(href: string): string {
  const url = URL.parse(href);
  if (!url) return "null";
  if (url.protocol === "file:") return "file://";
  if (url.protocol === "blob:") return url.pathname.startsWith("blob:") ? "null" : originOf(url.pathname);
  return url.origin === "null" && privilegesOf(url.protocol).standard ? `${url.protocol}//${url.host}` : url.origin;
}

function isSecure(href: string) {
  const { protocol, hostname } = new URL(href);
  return (
    /^(?:https|wss|file|about|data|blob):$/.test(protocol) ||
    !!privilegesOf(protocol).secure ||
    (/^(?:http|ws):$/.test(protocol) && /^(?:localhost|.*\.localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(hostname))
  );
}

const escapeRegExp = (text: string) => text.replace(/[\\^$.|?+()[\]{}]/g, "\\$&");
const glob = (pattern: string) => new RegExp(`^${escapeRegExp(pattern).replaceAll("*", ".*")}$`, "s");

/** The match patterns of `webRequest`. */
function matchPattern(pattern: string): (url: URL) => boolean {
  if (pattern === "<all_urls>") return () => true;
  const match = /^([^:]+):\/\/([^/]*)(\/.*)?$/s.exec(pattern);
  if (!match) throw new TypeError(`Invalid url pattern ${pattern}`);
  const [, scheme, authority, rest = "/"] = match;
  const [, host, port = "*"] = /^(.*?)(?::(\*|\d+))?$/.exec(authority)!;
  const pathname = glob(rest);
  const defaultPort = (url: URL) => (/^(?:https|wss):$/.test(url.protocol) ? "443" : "80");
  return url =>
    (scheme === "*" ? /^(?:http|ws)s?:$/.test(url.protocol) : url.protocol === scheme + ":") &&
    (host === "*" ||
      url.hostname === host ||
      (host.startsWith("*.") && (url.hostname === host.slice(2) || url.hostname.endsWith(host.slice(1))))) &&
    (port === "*" || (url.port || defaultPort(url)) === port) &&
    pathname.test((url.pathname || "/") + url.search);
}

const trusted: RegExp[] = [];

const excepted: RegExp[] = [];
const isExcepted = (href: string) => excepted.some(pattern => pattern.test(href));
const exceptedWhenLoaded: RegExp[] = [];
const endsTrustedDocument = (href: string) =>
  isExcepted(href) && !exceptedWhenLoaded.some(pattern => pattern.test(href));
let trustsFrames = false;
const trustedInFrames: RegExp[] = [];
let trustsInjectedScripts = false;

function trust(
  origins: string[],
  options?: {
    inFrames?: boolean | string[];
    injectedScripts?: boolean;
    except?: string[];
    exceptWhenLoaded?: string[];
  },
) {
  for (const url of options?.except ?? []) excepted.push(glob(url));
  for (const url of options?.exceptWhenLoaded ?? []) {
    excepted.push(glob(url));
    exceptedWhenLoaded.push(glob(url));
  }
  for (const origin of origins) trusted.push(glob(origin));
  if ($isArray(options?.inFrames)) for (const url of options.inFrames) trustedInFrames.push(glob(url));
  else trustsFrames ||= !!options?.inFrames;
  trustsInjectedScripts ||= !!options?.injectedScripts;
}

/** What a page has made up is not trusted because the page is. */
function isTrustedInFrame(href: string, appPath: string) {
  const scheme = /^(?:about|blob|data):/.exec(href)?.[0];
  if (!trustsFrames) return isTrustedOrigin(originOf(href)) && trustedInFrames.some(pattern => pattern.test(href));
  if (href.startsWith("javascript:")) return true;
  return scheme === undefined
    ? isTrusted(href, appPath)
    : href === "about:blank" || trusted.some(it => it.test(scheme));
}

const isTrustedOrigin = (origin: string) => trusted.some(pattern => pattern.test(origin));

/** There is no sandbox, so the scripts of a document can do what the app can. */
function isTrusted(href: string, appPath: string) {
  const url = new URL(href);
  if (url.protocol === "file:") {
    const relative = path.relative(appPath, Bun.fileURLToPath(url));
    return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
  }
  if (url.protocol === "blob:" || isExcepted(url.href)) return false;
  const origin = originOf(href);
  return isTrustedOrigin(origin === "null" ? url.protocol : origin);
}

/** What can be registered, of a host that is a domain. */
function siteOf(host: string): string {
  if (/^\[|^[\d.]+$/.test(host)) return host;
  const bare = host.replace(/\.$/, "");
  const length = require("internal/desktop/web/public_suffixes").suffixLength(bare);
  return (
    bare
      .split(".")
      .slice(-length - 1)
      .join(".") + host.slice(bare.length)
  );
}

function isSameSite(href: string, other: string, ignoresScheme = false) {
  const [a, b] = [URL.parse(href), URL.parse(other)];
  if (!a || !b || (!ignoresScheme && a.protocol.replace("ws", "http") !== b.protocol.replace("ws", "http")))
    return false;
  if (a.hostname === b.hostname) return true;
  const tail = (url: URL) => /[^.]*\.[^.]*\.?$/.exec(url.hostname)?.[0];
  return tail(a) === tail(b) && siteOf(a.hostname) === siteOf(b.hostname);
}

const entities = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };
const unescapeHtml = (text: string) =>
  text.replace(/&(?:#(x?)([\da-f]{1,6})|(\w+));/gi, (whole, isHex, code, name) =>
    code ? String.fromCharCode(parseInt(code, isHex ? 16 : 10)) : (entities[name] ?? whole),
  );

/** The scripts, event handlers and `javascript:` URLs in the markup of a document. */
function inlineScriptsOf(html: string) {
  const text = html.replace(/\r\n?/g, "\n");
  const found = new Set<string>();
  for (const match of text.matchAll(/<script\b[^>]*>(.*?)<\/script/gis)) found.$add(match[1]);
  for (const match of text.matchAll(/\s(on\w+|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const value = unescapeHtml(match[2] ?? match[3] ?? match[4]);
    if (match[1].toLowerCase() !== "href") found.$add(value);
    else if (value.startsWith("javascript:")) found.$add(value.slice("javascript:".length));
  }
  return found;
}

/** `integrity` is the attribute of an element. */
function hashesIn(integrity: string): string[][] {
  const found = integrity.matchAll(/(?<=^|\s)(sha(?:256|384|512))-([\w+/-]+={0,2})(?=$|[\s?])/gi);
  return Array.from(found, match => [match[1].toLowerCase(), match[2]]);
}

function hasIntegrity(bytes: Uint8Array, integrity: string) {
  const hashes = hashesIn(integrity);
  const strongest = hashes.reduce((most, [algorithm]) => (algorithm > most ? algorithm : most), "");
  if (!strongest) return true;
  const actual = Bun.CryptoHasher.hash(strongest as "sha256", bytes, "base64url");
  const toUrlSafe = (hash: string) => hash.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return hashes.some(([algorithm, hash]) => algorithm === strongest && toUrlSafe(hash) === actual);
}

function resolveBlob(href: string): Blob | undefined {
  const id = /^blob:.*[/]([\da-f-]{36})$/.exec(href.split("#")[0])?.[1];
  return id === undefined ? id : require("node:buffer").resolveObjectURL("blob:" + id);
}

export default {
  resolveBlob,
  trustsInjectedScripts: () => trustsInjectedScripts,
  endsTrustedDocument,
  hasLocalFrames: () => trustsFrames || trustedInFrames.length > 0,
  isExcepted,
  hasIntegrity,
  hashesIn,
  isSameSite,
  siteOf,
  inlineScriptsOf,
  schemes,
  privilegesOf,
  originOf,
  isSecure,
  glob,
  matchPattern,
  trust,
  isTrusted,
  isTrustedOrigin,
  isTrustedInFrame,
  trustsFrames: () => trustsFrames,
};
