// A place in untyped code that reads or stores `url`, `pathname`, `status`, `size` .. meets host objects, where the name is an accessor of a locked prototype, and the program's own objects, where it is plain data. Each place sees many of one kind, then the others in turn.
const lines = [];
const warm = 40;
const show = value => (typeof value === "string" ? JSON.stringify(value) : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : String(value));
const attempt = work => {
  try {
    return show(work());
  } catch (error) {
    return "throws " + error.constructor.name;
  }
};

const readers = {
  url: o => o.url,
  method: o => o.method,
  headers: o => o.headers,
  body: o => o.body,
  bodyUsed: o => o.bodyUsed,
  signal: o => o.signal,
  status: o => o.status,
  statusText: o => o.statusText,
  ok: o => o.ok,
  type: o => o.type,
  redirected: o => o.redirected,
  href: o => o.href,
  origin: o => o.origin,
  protocol: o => o.protocol,
  host: o => o.host,
  hostname: o => o.hostname,
  port: o => o.port,
  pathname: o => o.pathname,
  search: o => o.search,
  searchParams: o => o.searchParams,
  hash: o => o.hash,
  username: o => o.username,
  size: o => o.size,
  count: o => o.count,
  name: o => o.name,
  lastModified: o => typeof o.lastModified,
};
const writers = {
  url: (o, v) => { o.url = v; },
  method: (o, v) => { o.method = v; },
  status: (o, v) => { o.status = v; },
  href: (o, v) => { o.href = v; },
  pathname: (o, v) => { o.pathname = v; },
  search: (o, v) => { o.search = v; },
  hash: (o, v) => { o.hash = v; },
  port: (o, v) => { o.port = v; },
  size: (o, v) => { o.size = v; },
  name: (o, v) => { o.name = v; },
};
const otherWriters = {
  url: (o, v) => { o.url = v; },
  pathname: (o, v) => { o.pathname = v; },
  status: (o, v) => { o.status = v; },
  size: (o, v) => { o.size = v; },
};

class Own {
  constructor(seed) {
    for (const name of Object.keys(readers)) this[name] = name + seed;
  }
}
class OwnWithFields {
  url = "own url";
  pathname = "own pathname";
  status = 299;
  size = 7;
  name = "own name";
}
class Heir extends URL {
  constructor(address) {
    super(address);
    this.extra = 1;
  }
}
class HeirThatHides extends Request {
  get url() {
    return "hidden " + super.url;
  }
}
const [URL_NAME, PATHNAME, STATUS] = JSON.parse('["url","pathname","status"]');
const withGetters = () => {
  let reads = 0;
  const o = {};
  for (const name of [URL_NAME, PATHNAME, STATUS]) Object.defineProperty(o, name, { configurable: true, get() { return name + " read " + ++reads; }, set(v) { reads += v.length ?? 100; } });
  return o;
};

const address = "http://user@example.com:8080/a/b?c=d&e=f#g";
const makers = {
  request: () => new Request(address.replace("user@", ""), { method: "POST", headers: { "x-one": "1" }, body: "abc" }),
  response: () => new Response("abc", { status: 201, statusText: "Made", headers: { "x-two": "2" } }),
  url: () => new URL(address),
  parameters: () => new URLSearchParams("a=1&b=2&a=3"),
  headers: () => new Headers({ a: "1", b: "2" }),
  blob: () => new Blob(["abcd"], { type: "text/plain" }),
  file: () => new File(["abcde"], "five.txt", { type: "text/plain", lastModified: 5 }),
  literal: () => ({ url: "/plain", method: "GET", headers: { h: 1 }, status: 200, pathname: "/p", search: "?s", hash: "#h", href: "/p?s#h", size: 3, type: "t", name: "n", ok: false, body: null }),
  otherOrder: () => ({ name: "n2", size: 4, hash: "", pathname: "/q", url: "/other" }),
  own: () => new Own(1),
  fields: () => new OwnWithFields(),
  heir: () => new Heir(address),
  hides: () => new HeirThatHides("http://example.com/hidden"),
  getters: withGetters,
  inherits: () => Object.create({ url: "inherited url", pathname: "inherited pathname", status: 1, size: 2 }),
  inheritsHost: () => Object.create(new URL(address)),
  bare: () => Object.create(null),
  empty: () => ({}),
  frozen: () => Object.freeze({ url: "frozen", pathname: "/frozen", status: 5, size: 6, name: "f" }),
  proxy: () => new Proxy({}, { get: (_, key) => "proxy " + String(key), set: () => true }),
  map: () => new Map([[1, 2]]),
  set: () => new Set([1, 2, 3]),
  array: () => [1, 2],
  text: () => "text",
  number: () => 5,
  func: () => function named() {},
  nothing: () => null,
  missing: () => undefined,
};
const kinds = Object.keys(makers);

for (const first of ["request", "url", "response", "literal", "own", "file"]) {
  for (const [name, read] of Object.entries(readers)) {
    const seen = makers[first]();
    for (let turn = 0; turn < warm; turn++) read(seen);
    lines.push(first + " first, " + name + ": " + kinds.map(kind => attempt(() => read(makers[kind]()))).join(" | "));
    lines.push(first + " again, " + name + ": " + attempt(() => read(seen)));
  }
}

for (const [title, all] of [["stores", writers], ["stores at other places", otherWriters]]) {
  for (const first of ["url", "literal", "request", "own"]) {
    for (const [name, write] of Object.entries(all)) {
      const seen = makers[first]();
      for (let turn = 0; turn < warm; turn++) attempt(() => write(seen, name === "port" ? "81" : name === "href" ? "http://example.org/z" : "/w" + (turn % 3)));
      lines.push(title + ", " + first + " first, " + name + ": " + kinds.map(kind => {
        const o = makers[kind]();
        const said = attempt(() => write(o, name === "port" ? "82" : name === "href" ? "http://example.net/y" : "/v"));
        return said + " " + attempt(() => readers[name](o));
      }).join(" | "));
      lines.push(title + ", " + first + " again, " + name + ": " + attempt(() => readers[name](seen)));
    }
  }
}

{
  const location = makers.url();
  const plain = makers.literal();
  let text = "";
  for (let turn = 0; turn < 64; turn++) {
    const o = turn % 2 ? location : plain;
    writers.pathname(o, "/t" + turn);
    text = readers.pathname(o) + readers.href(o).length + text.length;
  }
  lines.push("in turns: " + text + " " + location.href + " " + plain.pathname);
}

console.log(lines.join("\n"));
