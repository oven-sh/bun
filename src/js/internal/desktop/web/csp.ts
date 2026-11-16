// https://w3c.github.io/webappsec-csp/
const { hashesIn, originOf, privilegesOf } = require("internal/desktop/electron/policy");

type Policy = { directives: Map<string, string[]>; text: string; isEnforced: boolean };
type Details = { blockedURI: string; sample?: string; element?: object };
type Fetched = {
  nonce?: string;
  integrity?: string;
  /** Not for an element that is in the markup. */
  byScript?: boolean;
  /** Where the request began, if it was redirected. */
  redirectedFrom?: string;
  isPrefetch?: boolean;
  element?: object;
};

const directiveFor: Record<string, string> = {
  __proto__: null as any,
  "": "connect-src",
  "json": "connect-src",
  "text": "connect-src",
  "script": "script-src-elem",
  "xslt": "script-src-elem",
  "audioworklet": "script-src-elem",
  "paintworklet": "script-src-elem",
  "style": "style-src-elem",
  "image": "img-src",
  "font": "font-src",
  "audio": "media-src",
  "video": "media-src",
  "track": "media-src",
  "frame": "frame-src",
  "iframe": "frame-src",
  "worker": "worker-src",
  "sharedworker": "worker-src",
  "manifest": "manifest-src",
  "object": "object-src",
  "embed": "object-src",
};

const fallbacks: Record<string, string[]> = {
  __proto__: null as any,
  "script-src-elem": ["script-src", "default-src"],
  "script-src-attr": ["script-src", "default-src"],
  "style-src-elem": ["style-src", "default-src"],
  "style-src-attr": ["style-src", "default-src"],
  "frame-src": ["child-src", "default-src"],
  "worker-src": ["child-src", "script-src", "default-src"],
  "base-uri": [],
  "form-action": [],
  "frame-ancestors": [],
};

function sourcesFor({ directives }: Policy, directive: string): string[] | undefined {
  let found = directives.$get(directive);
  for (const name of fallbacks[directive] ?? ["default-src"]) found ??= directives.$get(name);
  return found;
}

const has = (sources: string[], keyword: string) => sources.some(source => source.toLowerCase() === keyword);
const defaultPorts = { "http:": "80", "ws:": "80", "https:": "443", "wss:": "443", "ftp:": "21" };

function schemeMatches(source: string, actual: string) {
  return (
    source === actual ||
    (source === "http:" && actual === "https:") ||
    (source === "ws:" && /^(?:wss|http|https):$/.test(actual)) ||
    (source === "wss:" && actual === "https:")
  );
}

function pathMatches(wanted: string, actual: string) {
  const parts = (path: string) => path.split("/").map(part => unescape(part));
  const [a, b] = [parts(wanted), parts(actual)];
  if (wanted.endsWith("/")) a.pop();
  else if (a.length !== b.length) return false;
  return a.length <= b.length && a.every((part, i) => part === b[i]);
}

function sourceMatches(source: string, url: URL, self: URL, redirected: boolean) {
  const lower = source.toLowerCase();
  if (lower === "*") return /^(?:http|ws)s?:$/.test(url.protocol) || url.protocol === self.protocol;
  if (lower === "'self'") {
    if (originOf(self.href) === "null" || (url.protocol === "blob:" && self.protocol !== "blob:")) return false;
    if (originOf(url.href) === originOf(self.href)) return true;
    const upgrades = /^(?:https|wss):$/.test(url.protocol) || (self.protocol === "http:" && url.protocol === "ws:");
    return upgrades && /^https?:$/.test(self.protocol) && url.host === self.host;
  }
  if (lower[0] === "'") return false;
  if (/^[a-z][a-z\d+.-]*:$/.test(lower)) return schemeMatches(lower, url.protocol);
  const match =
    /^(?:([a-z][a-z\d+.-]*:)\/\/)?(\*|(?:\*\.)?[^/:*]+|\[[^\]]+\])(?::(\*|\d+))?(\/[^?#]*)?(?:[?#].*)?$/i.exec(source);
  if (!match || !url.hostname) return false;
  const [, scheme = self.protocol, host, port, path] = match;
  if (!schemeMatches(scheme.toLowerCase(), url.protocol)) return false;
  const hostname = url.hostname.toLowerCase();
  const wanted = host.toLowerCase();
  if (wanted[0] === "*" ? !hostname.endsWith(wanted.slice(1)) : hostname !== wanted) return false;
  const actualPort = url.port || defaultPorts[url.protocol];
  if (
    port === undefined ? url.port : port !== "*" && +port !== +actualPort && !(port === "80" && actualPort === "443")
  ) {
    return false;
  }
  return !path || redirected || pathMatches(path, url.pathname);
}

const nonceIn = (source: string) => /^'nonce-([\w+/-]+={0,2})'$/i.exec(source)?.[1];
const hashIn = (source: string) => /^'(sha(?:256|384|512))-([\w+/-]+={0,2})'$/i.exec(source);
const urlSafe = (hash: string) => hash.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const hasNonce = (sources: string[], nonce: string) =>
  nonce !== "" && sources.some(source => nonceIn(source) === nonce);

function hasHashes(sources: string[], integrity: string) {
  const given: string[][] = hashesIn(integrity);
  const isListed = ([algorithm, value]: string[]) =>
    sources.map(hashIn).some(hash => hash?.[1].toLowerCase() === algorithm && urlSafe(hash[2]) === urlSafe(value));
  return given.length > 0 && given.every(isListed);
}

function forReport(href: string) {
  const url = new URL(href);
  if (!/^(?:http|ws)s?:$/.test(url.protocol) && !privilegesOf(url.protocol).standard) return url.protocol.slice(0, -1);
  url.username = url.password = url.hash = "";
  return url.href;
}

class ContentSecurityPolicy {
  /** Gets the members of a `SecurityPolicyViolationEvent` that depend on the policy, and where to report to. */
  onViolation: ((violation: object, urls: string[], group: string | undefined, element?: object) => void) | undefined;
  #self: URL;
  #policies: Policy[] = [];

  constructor(documentUrl: string) {
    this.#self = new URL(documentUrl);
  }

  /** For a document or a worker that has no URL of its own to speak of. */
  copy() {
    const copy = new ContentSecurityPolicy(this.#self.href);
    copy.#policies = [...this.#policies];
    return copy;
  }

  isFromHeader = false;

  add(header: string, isEnforced = true, isFromMarkup = false) {
    for (const policy of header.split(",")) {
      const directives = new Map<string, string[]>();
      for (const directive of policy.split(";")) {
        const [name, ...sources] = directive.split(/[\t\n\f\r ]+/).filter(Boolean);
        if (!name || /[^\0-\x7f]/.test(directive) || directives.$has(name.toLowerCase())) continue;
        if (!isFromMarkup || !/^(?:sandbox|frame-ancestors|report-uri)$/i.test(name))
          directives.$set(name.toLowerCase(), sources);
      }
      if (directives.$size > 0) this.#policies.push({ directives, text: policy.trim(), isEnforced });
      this.isFromHeader ||= directives.$size > 0 && !isFromMarkup;
    }
  }

  addFrom(headers: string[][]) {
    for (const [name, value] of headers) {
      if (/^content-security-policy(?:-report-only)?$/i.test(name)) this.add(value, name.length === 23);
    }
  }

  isEmpty() {
    return this.#policies.length === 0;
  }

  toString() {
    const directives = (policy: Policy) => [...policy.directives].map(it => it.flat().join(" ")).join(";");
    return this.#enforced().map(directives).join(",");
  }

  #enforced() {
    return this.#policies.filter(policy => policy.isEnforced);
  }

  /** Without `details`, nothing is reported. */
  #check(directive: string, allows: (sources: string[], policy: Policy) => boolean, details?: () => Details) {
    let isAllowed = true;
    for (const policy of this.#policies) {
      const sources = sourcesFor(policy, directive);
      if (sources === undefined || allows(sources, policy)) continue;
      if (policy.isEnforced) isAllowed = false;
      if (details) {
        const { sample = "", ...rest } = details();
        this.#report(policy, directive, {
          ...rest,
          sample: has(sources, "'report-sample'") ? sample.slice(0, 40) : "",
        });
      }
    }
    return isAllowed;
  }

  #report({ directives, text, isEnforced }: Policy, directive: string, details: Details) {
    const violation = {
      blockedURI: details.blockedURI,
      effectiveDirective: directive,
      violatedDirective: directive,
      originalPolicy: text,
      disposition: isEnforced ? "enforce" : "report",
      sample: details.sample,
    };
    const group = directives.$get("report-to")?.[0];
    this.onViolation?.(violation, (group === undefined && directives.$get("report-uri")) || [], group, details.element);
  }

  #lists(sources: string[], url: URL, redirected: boolean) {
    return sources.some(source => sourceMatches(source, url, this.#self, redirected));
  }

  allowsUrl(href: string, destination: string, fetched: Fetched = {}) {
    if (this.#policies.length === 0) return true;
    const { nonce = "", integrity, byScript = true, redirectedFrom, isPrefetch, element } = fetched;
    const directive = isPrefetch ? "default-src" : directiveFor[destination];
    const url = new URL(href);
    if (directive === undefined || privilegesOf(url.protocol).bypassCSP) return true;
    const isScript = directive === "script-src-elem" || directive === "worker-src";
    const lists = (sources: string[]) => this.#lists(sources, url, redirectedFrom !== undefined);
    const hidesPath = (directive === "frame-src" || directive === "object-src") && url.origin !== this.#self.origin;
    return this.#check(
      directive,
      (sources, { directives }) => {
        if (isPrefetch) return [...directives].some(([name, others]) => name.endsWith("-src") && lists(others));
        if ((isScript || destination === "style") && hasNonce(sources, nonce)) return true;
        if (isScript && hasHashes(sources, integrity ?? "")) return true;
        return isScript && has(sources, "'strict-dynamic'") ? byScript : lists(sources);
      },
      () => {
        const blockedURI = forReport(redirectedFrom ?? href);
        return { blockedURI: hidesPath ? (URL.parse(blockedURI)?.origin ?? blockedURI) : blockedURI, element };
      },
    );
  }

  /** Without anything to report. */
  allowsInlineImages() {
    const url = new URL("data:,");
    return this.#policies.every(policy => {
      const sources = sourcesFor(policy, "img-src");
      return sources === undefined || this.#lists(sources, url, false);
    });
  }

  /** `kind` is "script" or "style", `place` "element", "attribute" or "navigation". */
  allowsInline(kind: string, text: string, place: string, { nonce = "", byScript = false, element }: Fetched = {}) {
    return this.#check(
      `${kind}-src-${place === "attribute" ? "attr" : "elem"}`,
      sources => {
        const isDynamic = kind === "script" && has(sources, "'strict-dynamic'");
        const hashes = sources.map(hashIn).filter(hash => hash !== null);
        if (!isDynamic && hashes.length === 0 && !sources.some(nonceIn)) return has(sources, "'unsafe-inline'");
        if (place === "element" && (hasNonce(sources, nonce) || (isDynamic && byScript))) return true;
        if (place !== "element" && !has(sources, "'unsafe-hashes'")) return false;
        const hashed = place === "navigation" ? "javascript:" + text : text;
        return hashes.some(
          ([, algorithm, value]) =>
            urlSafe(value) ===
            Bun.CryptoHasher.hash(algorithm.toLowerCase() as "sha256", hashed.toWellFormed(), "base64url"),
        );
      },
      () => ({ blockedURI: "inline", sample: text, element }),
    );
  }

  /** What is refused is reported if there is `code`. */
  allowsEval(code?: string) {
    const isTrusted = this.#enforced().some(requiresTrustedTypes);
    return this.#check(
      "script-src",
      sources => has(sources, "'unsafe-eval'") || (isTrusted && has(sources, "'trusted-types-eval'")),
      code === undefined ? undefined : () => ({ blockedURI: "eval", sample: code }),
    );
  }

  allowsWebAssembly() {
    return this.#check("script-src", sources => has(sources, "'wasm-unsafe-eval'") || has(sources, "'unsafe-eval'"));
  }

  /** Whether each string has to be shown before it is compiled. */
  watchesEval() {
    return this.#policies.some(
      policy => requiresTrustedTypes(policy) || (!policy.isEnforced && sourcesFor(policy, "script-src") !== undefined),
    );
  }

  restrictsStyleAttributes() {
    return this.#policies.some(policy => {
      const sources = sourcesFor(policy, "style-src-attr");
      return sources && (!has(sources, "'unsafe-inline'") || sources.some(it => nonceIn(it) || hashIn(it)));
    });
  }

  restrictsScripts() {
    return this.#enforced().some(({ directives }) => directives.$has("script-src") || directives.$has("default-src"));
  }

  /** For "base-uri" and "form-action". */
  allowsFor(directive: string, href: string, redirectedFrom?: string) {
    return this.#check(
      directive,
      sources => this.#lists(sources, new URL(href), redirectedFrom !== undefined),
      () => ({ blockedURI: forReport(redirectedFrom ?? href) }),
    );
  }

  allowsAncestors(origins: string[]) {
    return this.#check(
      "frame-ancestors",
      sources => origins.every(origin => origin !== "null" && this.#lists(sources, new URL(origin), false)),
      () => ({ blockedURI: forReport(this.#self.href) }),
    );
  }

  listsOrigin(sources: string[], origin: string) {
    return origin !== "null" && this.#lists(sources, new URL(origin), false);
  }

  has(directive: string) {
    return this.#enforced().some(policy => policy.directives.$has(directive));
  }

  /** What all `sandbox` directives allow. Undefined if there is none. */
  sandbox(): string[] | undefined {
    let allowed: string[] | undefined;
    for (const { directives } of this.#enforced()) {
      const flags = directives.$get("sandbox")?.map(flag => flag.toLowerCase());
      if (flags) allowed = allowed?.filter(flag => flags.includes(flag)) ?? flags;
    }
    return allowed;
  }

  allowsScripts() {
    return this.sandbox()?.includes("allow-scripts") ?? true;
  }

  requiresTrustedTypes() {
    return this.#policies.some(requiresTrustedTypes);
  }

  allowsTrustedTypesEval() {
    const isListed = (policy: Policy) => has(sourcesFor(policy, "script-src") ?? [], "'trusted-types-eval'");
    return this.#enforced().some(requiresTrustedTypes) && this.#enforced().some(isListed) && this.allowsEval();
  }

  /** Reports that a string was passed to `sink`. */
  allowsStringFor(sink: string, value: string) {
    const violated = this.#policies.filter(requiresTrustedTypes);
    for (const policy of violated) {
      const sample = `${sink}|${value.slice(0, 40)}`;
      this.#report(policy, "require-trusted-types-for", { blockedURI: "trusted-types-sink", sample });
    }
    return !violated.some(policy => policy.isEnforced);
  }

  allowsTypePolicy(name: string, isTaken: boolean) {
    let isAllowed = true;
    for (const policy of this.#policies) {
      const names = policy.directives.$get("trusted-types");
      if (!names) continue;
      const isListed = names.includes("*") || (/^[\w#=/@.%-]+$/.test(name) && names.includes(name));
      if (isListed && (!isTaken || has(names, "'allow-duplicates'"))) continue;
      if (policy.isEnforced) isAllowed = false;
      this.#report(policy, "trusted-types", { blockedURI: "trusted-types-policy", sample: name.slice(0, 40) });
    }
    return isAllowed;
  }
}

const requiresTrustedTypes = (policy: Policy) =>
  has(policy.directives.$get("require-trusted-types-for") ?? [], "'script'");

export default { ContentSecurityPolicy, forReport };
