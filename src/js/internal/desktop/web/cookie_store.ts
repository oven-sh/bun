const idl = require("internal/desktop/web/idl");

const { scope, usv } = idl;
const frozen = (value: unknown) => Object.freeze(idl.sequence(value));
const CookieChangeEvent = idl.eventClass("CookieChangeEvent", {
  changed: [frozen, Object.freeze([])],
  deleted: [frozen, Object.freeze([])],
});

const trim = (text: string) => text.replace(/^[\t ]+|[\t ]+$/g, "");

function describe({ domain, expirationDate, hostOnly, name, partition, path, sameSite, secure, value }: any) {
  return {
    domain: hostOnly ? null : domain.slice(1),
    expires: expirationDate === undefined ? null : expirationDate * 1000,
    name,
    partitioned: !!partition,
    path,
    sameSite: sameSite === "no_restriction" ? "none" : sameSite === "strict" ? sameSite : "lax",
    secure,
    value,
  };
}

function requireAccess() {
  if (scope.env.origin === "null")
    throw idl.error("SecurityError", "Access to the CookieStore API is denied in this context.");
}

function query(given: any, isRequired: boolean) {
  const { name, url } = given == null || $isObject(given) ? idl.dictionary(given) : { name: given };
  requireAccess();
  if (isRequired && name === undefined && url === undefined)
    throw new TypeError("CookieStoreGetOptions must not be empty");
  const own = scope.global.document.URL.split("#")[0];
  if (url !== undefined && idl.parseUrl(usv(url))?.href.split("#")[0] !== own)
    throw new TypeError("URL must match the document URL");
  return scope.env
    .cookies(own)
    .filter(cookie => name === undefined || cookie.name === trim(usv(name)))
    .map(describe);
}

function store({
  name,
  value,
  domain = null,
  path = "/",
  expires = null,
  maxAge = null,
  sameSite = "strict",
  partitioned,
}: any) {
  [name, value, path] = [trim(usv(name)), trim(usv(value)), usv(path)];
  if (domain !== null) domain = usv(domain);
  sameSite = idl.oneOf(sameSite, ["strict", "lax", "none"]);
  requireAccess();
  const isValid =
    !(name + value + domain + path).includes(";") &&
    !name.includes("=") &&
    domain?.[0] !== "." &&
    domain !== "" &&
    (path === "" || path[0] === "/") &&
    (expires === null || maxAge === null) &&
    Buffer.byteLength(path) <= 1024 &&
    Buffer.byteLength(domain ?? "") <= 1024;
  const attributes = [
    `${name}=${value}`,
    "secure",
    "samesite=" + sameSite,
    path && "path=" + path,
    domain && "domain=" + domain,
    expires !== null && "max-age=" + Math.ceil((idl.finite(expires) - Date.now()) / 1000),
    maxAge !== null && "max-age=" + Math.trunc(maxAge),
    partitioned && "partitioned",
  ];
  if (!isValid || !scope.env.setCookie(attributes.filter(Boolean).join(";")))
    throw new TypeError("The cookie was refused.");
}

class CookieStore extends idl.EventTarget {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
    super();
    scope.env.watchCookies((cookie: any, removed: boolean) => {
      const init = removed ? { deleted: [{ ...describe(cookie), value: undefined }] } : { changed: [describe(cookie)] };
      idl.queueTask(() => idl.dispatchInTask(this, new CookieChangeEvent("change", init)));
    });
  }

  async get(name: unknown = undefined) {
    return query(name, true)[0] ?? null;
  }

  async getAll(name: unknown = undefined) {
    return [...query(name, false)];
  }

  async set(name: any, value: unknown = undefined) {
    idl.need(arguments.length, 1);
    if (arguments.length > 1) return store({ name, value });
    const init = idl.dictionary(name);
    if (init.name === undefined || init.value === undefined) throw new TypeError("name and value are required.");
    store(init);
  }

  async delete(name: any) {
    idl.need(arguments.length, 1);
    const init = name == null || $isObject(name) ? idl.dictionary(name) : { name };
    if (init.name === undefined) throw new TypeError("name is required.");
    const { domain, partitioned, path } = init;
    store({ name: init.name, value: trim(`${init.name}`) ? "" : "deleted", domain, partitioned, path, maxAge: 0 });
  }
}
idl.defineHandlers(CookieStore.prototype, ["change"]);
idl.expose(CookieStore);

export default { CookieChangeEvent, CookieStore };
