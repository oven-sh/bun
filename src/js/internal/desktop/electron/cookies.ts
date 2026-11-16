const EventEmitter = require("node:events");
const { Event } = require("internal/desktop/app");
const crypt = require("internal/desktop/electron/os_crypt");
const { isSecure, privilegesOf, siteOf } = require("internal/desktop/electron/policy");

type Cookie = {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  session: boolean;
  expirationDate?: number;
  sameSite: string;
  /** The site of the top-level document that it is for. */
  partition?: string;
};

type Context = {
  isSameSite?: boolean;
  /** For a top-level document. */
  navigates?: boolean;
  isSafe?: boolean;
  /** A URL of the site of the top-level document. */
  partition?: string;
  forScript?: boolean;
};

const idOf = (cookie: Cookie) =>
  `${cookie.domain}\n${cookie.path}\n${cookie.name}${cookie.partition ? "\n" + cookie.partition : ""}`;
const isExpired = (cookie: Cookie) => cookie.expirationDate !== undefined && cookie.expirationDate * 1000 <= Date.now();
const isWithin = (host: string, domain: string) => host === domain || host.endsWith("." + domain);
const withoutDot = (domain: string) => domain.replace(/^\./, "").toLowerCase();
const isAddress = (host: string) => /^\[|^[\d.]+$/.test(host);
const hasCookies = (url: URL) => /^(?:http|ws)s?:$/.test(url.protocol) || !!privilegesOf(url.protocol).standard;
const defaultPath = (url: URL) => url.pathname.slice(0, url.pathname.lastIndexOf("/")) || "/";

const MAX_AGE = 400 * 24 * 60 * 60;
const MAX_FOR_SITE = 180;
const trim = (text: string) => text.replace(/^[\t ]+|[\t ]+$/g, "");
const isPublicSuffix = (host: string) => !host.includes(".") || siteOf("_." + host) === "_." + host;

function partitionOf(href = "") {
  const url = URL.parse(href);
  return url ? `${url.protocol}//${siteOf(url.hostname)}` : "null";
}

function isUnder(path: string, pathname: string) {
  return (
    pathname.startsWith(path) &&
    (pathname.length === path.length || path.endsWith("/") || pathname[path.length] === "/")
  );
}

function appliesTo(cookie: Cookie, url: URL) {
  return (
    (cookie.hostOnly ? url.hostname === cookie.domain : isWithin(url.hostname, cookie.domain.slice(1))) &&
    isUnder(cookie.path, url.pathname || "/") &&
    (!cookie.secure || isSecure(url.href))
  );
}

/** What is wrong with it, if anything. */
function validate(cookie: Cookie, url: URL) {
  if (!hasCookies(url)) return "Attempted to set a cookie from a scheme that does not support cookies.";
  if (/[\0-\x08\n-\x1f\x7f;]/.test(cookie.name + cookie.value)) {
    return "The cookie contains ASCII control characters or semicolons.";
  }
  if (!cookie.hostOnly && (!isWithin(url.hostname, cookie.domain.slice(1)) || isPublicSuffix(cookie.domain.slice(1)))) {
    return "The cookie was set with an invalid Domain attribute.";
  }
  if (cookie.secure && !isSecure(url.href)) return "Secure cookies can only be set from secure URLs.";
  if (cookie.sameSite === "no_restriction" && !cookie.secure) return "SameSite=None requires Secure.";
  if (cookie.partition && !cookie.secure) return "Partitioned requires Secure.";
  if (Buffer.byteLength(cookie.name + cookie.value) > 4096) return "The name and the value are too long.";
  if (!cookie.name && /^$|^__(?:host|secure|http)-|=/i.test(cookie.value)) return "The cookie has no name.";
  if (/^__(?:host-)?http-/i.test(cookie.name) && !(cookie.secure && cookie.httpOnly)) {
    return "The cookie violated the requirements of its prefix.";
  }
  const isHost = /^__host-/i.test(cookie.name);
  if (
    ((isHost || /^__secure-/i.test(cookie.name)) && !cookie.secure) ||
    (isHost && !(cookie.hostOnly && cookie.path === "/"))
  ) {
    return "The cookie violated the requirements of its prefix.";
  }
}

function domainFor(url: URL, domain: string | undefined) {
  const bare = domain && (URL.parse("http://" + withoutDot(domain))?.host ?? "?");
  const hostOnly = !bare || (bare === url.hostname && (isAddress(bare) || isPublicSuffix(bare)));
  return { hostOnly, domain: hostOnly ? url.hostname : "." + bare };
}

/** https://httpwg.org/http-extensions/draft-ietf-httpbis-rfc6265bis.html#cookie-date */
function parseDate(text = ""): number | undefined {
  let time: string[] | undefined;
  let day: string | undefined;
  let year: number | undefined;
  let month = -1;
  for (const token of text.split(/[\t\x20-\x2f\x3b-\x40\x5b-\x60\x7b-\x7e]+/)) {
    let found;
    if (!time && (found = /^(\d\d?):(\d\d?):(\d\d?)(?!\d)/.exec(token))) time = found;
    else if (!day && (found = /^\d\d?(?!\d)/.exec(token))) day = found[0];
    else if (month < 0 && (found = months.indexOf(token.slice(0, 3).toLowerCase())) >= 0) month = found;
    else if (year === undefined && (found = /^\d{2,4}(?!\d)/.exec(token))) year = +found[0];
  }
  if (!time || !day || month < 0 || year === undefined) return;
  if (year < 100) year += year < 70 ? 2000 : 1900;
  const date = new Date(Date.UTC(year, month, +day, +time[1], +time[2], +time[3]));
  if (year >= 1601 && date.getUTCDate() === +day && +time[2] < 60 && +time[3] < 60) return +date / 1000;
}
const months = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

function parse(header: string, url: URL, partition?: string): Cookie | undefined {
  if (/[\0-\x08\n-\x1f\x7f]/.test(header)) return;
  const [pair, ...attributes] = header.split(";");
  const equals = pair.indexOf("=");
  const found: Record<string, string> = { __proto__: null as any };
  for (const attribute of attributes) {
    const [name, ...parts] = attribute.split("=");
    const value = trim(parts.join("="));
    if (Buffer.byteLength(value) <= 1024) found[trim(name).toLowerCase()] = value;
  }
  const now = Date.now() / 1000;
  const expires = /^-?\d+$/.test(found["max-age"]) ? now + +found["max-age"] : parseDate(found.expires);
  const name = trim(pair.slice(0, Math.max(equals, 0)));
  if (/^__host-/i.test(name) && (found.domain || found.path !== "/")) return;
  return {
    name,
    value: trim(pair.slice(equals + 1)),
    ...domainFor(url, found.domain),
    path: found.path?.[0] === "/" ? found.path : defaultPath(url),
    secure: "secure" in found,
    httpOnly: "httponly" in found,
    session: expires === undefined,
    ...(expires !== undefined && { expirationDate: Math.min(expires, now + MAX_AGE) }),
    sameSite: { lax: "lax", strict: "strict", none: "no_restriction" }[found.samesite?.toLowerCase()] ?? "unspecified",
    ...("partitioned" in found && { partition: partitionOf(partition ?? url.href) }),
  };
}

const kJar = Symbol("jar");

class Jar {
  #cookies: Map<string, Cookie> | undefined;
  #createdAt = new WeakMap<Cookie, number>();
  /** Of pages and workers. */
  watchers = new Set<(cookie: Cookie, removed: boolean, cause: string) => void>();
  #unsaved = new Set<string>();
  #list: Cookie[] | undefined;
  #nextExpiry = 0;
  observe: ((cookie: Cookie, removed: boolean) => void) | undefined;

  constructor(
    readonly storage: any,
    readonly changed: (cookie: Cookie, cause: string, removed: boolean) => void,
  ) {}

  /** The same array until something changes. */
  all() {
    if (!this.#cookies) {
      this.#cookies = new Map();
      if (!crypt.canEncrypt()) return [];
      this.storage.importOnce("cookies", (cookies: Cookie[]) => cookies.forEach(cookie => this.#save(cookie)));
      for (const [id, cookie] of this.storage.sql.query("SELECT id, cookie FROM cookies ORDER BY rowid").values()) {
        try {
          this.#cookies.$set(id, JSON.parse(crypt.decrypt(Buffer.from(cookie)).toString()));
        } catch {}
      }
    }
    if (this.#list && Date.now() / 1000 < this.#nextExpiry) return this.#list;
    this.#nextExpiry = Infinity;
    for (const cookie of this.#cookies.values()) {
      if (isExpired(cookie)) this.remove(cookie, "expired");
      else this.#nextExpiry = Math.min(this.#nextExpiry, cookie.expirationDate ?? Infinity);
    }
    return (this.#list = [...this.#cookies.values()]);
  }

  remove(cookie: Cookie, cause: string) {
    this.#cookies!.$delete(idOf(cookie));
    this.#list = undefined;
    if (!cookie.session) this.#saveSoon(cookie);
    this.#tell(cookie, cause, true);
  }

  #save(cookie: Cookie) {
    const insert = this.storage.sql.query("INSERT OR REPLACE INTO cookies VALUES (?, ?)");
    insert.run(idOf(cookie), crypt.encrypt(JSON.stringify(cookie)));
  }

  #saveSoon(cookie: Cookie) {
    if (this.#unsaved.$size === 0) setTimeout(() => this.flush(), 1000).unref();
    this.#unsaved.$delete(idOf(cookie));
    this.#unsaved.$add(idOf(cookie));
  }

  flush() {
    if (this.#unsaved.$size === 0) return;
    const { sql } = this.storage;
    sql.transaction(() => {
      for (const id of this.#unsaved) {
        const cookie = this.#cookies!.$get(id);
        if (cookie && !cookie.session && crypt.canEncrypt()) this.#save(cookie);
        else sql.query("DELETE FROM cookies WHERE id = ?").run(id);
      }
    })();
    this.#unsaved.$clear();
  }

  store(cookie: Cookie) {
    this.all();
    const before = this.#cookies!.$get(idOf(cookie));
    if (before) this.remove(before, isExpired(cookie) ? "expired-overwrite" : "overwrite");
    if (isExpired(cookie)) return;
    this.#cookies!.$set(idOf(cookie), cookie);
    this.#list = undefined;
    if (!cookie.session) this.#saveSoon(cookie);
    this.#createdAt.set(cookie, Date.now());
    this.#tell(cookie, before?.value === cookie.value ? "inserted-no-value-change-overwrite" : "inserted", false);
  }

  #tell(cookie: Cookie, cause: string, removed: boolean) {
    this.observe?.(cookie, removed);
    this.changed(cookie, cause, removed);
    for (const watcher of this.watchers) watcher(cookie, removed, cause);
  }

  matching(url: URL, { isSameSite = true, navigates, isSafe, partition, forScript }: Context) {
    if (!hasCookies(url)) return [];
    const isYoung = (cookie: Cookie) => Date.now() - (this.#createdAt.get(cookie) ?? 0) < 120_000;
    return this.all()
      .filter(
        cookie =>
          appliesTo(cookie, url) &&
          !(forScript && cookie.httpOnly) &&
          (!cookie.partition || cookie.partition === partitionOf(partition ?? url.href)) &&
          (isSameSite ||
            cookie.sameSite === "no_restriction" ||
            (navigates &&
              (isSafe ? cookie.sameSite !== "strict" : cookie.sameSite === "unspecified" && isYoung(cookie)))),
      )
      .sort((a, b) => b.path.length - a.path.length);
  }

  header(url: URL, context: Context) {
    const text = this.matching(url, context)
      .map(cookie => (cookie.name ? `${cookie.name}=${cookie.value}` : cookie.value))
      .join("; ");
    return context.forScript ? text : Buffer.from(text).latin1Slice();
  }

  /** False if it was refused. */
  receive(header: string, url: URL, { isSameSite = true, navigates, partition, forScript }: Context) {
    const cookie = parse(forScript ? header : Buffer.from(header, "latin1").toString(), url, partition);
    if (!cookie || validate(cookie, url)) return false;
    if (!isSameSite && !navigates && cookie.sameSite !== "no_restriction") return false;
    const all = this.all();
    if (forScript && (cookie.httpOnly || this.#cookies!.$get(idOf(cookie))?.httpOnly)) return false;
    const domain = withoutDot(cookie.domain);
    const isShadowed = (it: Cookie) =>
      it.secure &&
      it.name === cookie.name &&
      (isWithin(domain, withoutDot(it.domain)) || isWithin(withoutDot(it.domain), domain)) &&
      isUnder(it.path, cookie.path);
    if (!isSecure(url.href) && all.some(isShadowed)) return false;
    this.store(cookie);
    const ofDomain = all.length >= MAX_FOR_SITE ? all.filter(it => withoutDot(it.domain) === domain) : [];
    if (ofDomain.length >= MAX_FOR_SITE) for (const it of ofDomain.slice(0, 30)) this.remove(it, "evicted");
    return true;
  }
}

class Cookies extends EventEmitter {
  [kJar]: Jar;

  constructor(storage: unknown) {
    super();
    this[kJar] = new Jar(storage, (cookie, cause, removed) =>
      setImmediate(() => this.emit("changed", new Event(), { ...cookie }, cause, removed)),
    );
  }

  async get(filter: Partial<Cookie> & { url?: string } = {}) {
    const url = filter.url ? new URL(filter.url) : undefined;
    return this[kJar]
      .all()
      .filter(
        cookie =>
          (!url || appliesTo(cookie, url)) &&
          (filter.domain === undefined || isWithin(withoutDot(cookie.domain), withoutDot(filter.domain))) &&
          ["name", "path", "secure", "session", "httpOnly"].every(
            key => filter[key] === undefined || filter[key] === cookie[key],
          ),
      )
      .map(cookie => ({ ...cookie }));
  }

  async set(details: Partial<Cookie> & { url: string }) {
    const url = URL.parse(details.url);
    if (!url) throw new Error("Failed to get cookie domain");
    const { name = "", value = "", expirationDate, sameSite = "lax" } = details;
    const cookie = {
      name,
      value,
      ...domainFor(url, details.domain),
      path: details.path || defaultPath(url),
      secure: details.secure ?? (isSecure(url.href) && sameSite === "no_restriction"),
      httpOnly: !!details.httpOnly,
      session: expirationDate === undefined,
      ...(expirationDate !== undefined && { expirationDate }),
      sameSite,
    };
    const problem = validate(cookie, url);
    if (problem) throw new Error(`Failed to set cookie - ${problem}`);
    this[kJar].store(cookie);
  }

  async remove(url: string, name: string) {
    const parsed = new URL(url);
    for (const cookie of this[kJar].all()) {
      if (cookie.name === name && appliesTo(cookie, parsed)) this[kJar].remove(cookie, "explicit");
    }
  }

  async flushStore() {
    this[kJar].flush();
  }
}

export default { Cookies, appliesTo, kJar, isWithin, withoutDot };
