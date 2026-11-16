// A radix tree of routes with parameters, wild cards and patterns, middleware that runs inward and outward, requests and responses as values
type Method = "GET" | "POST" | "PUT" | "DELETE";
type Params = Readonly<Record<string, string>>;
class Headers2 {
  readonly #map = new Map<string, string[]>();
  constructor(init: Record<string, string> = {}) {
    for (const k in init) this.set(k, init[k]);
  }
  get(name: string): string | null {
    return this.#map.get(name.toLowerCase())?.join(", ") ?? null;
  }
  set(name: string, value: string): this {
    this.#map.set(name.toLowerCase(), [value]);
    return this;
  }
  append(name: string, value: string): this {
    const list = this.#map.get(name.toLowerCase());
    if (list) list.push(value);
    else this.set(name, value);
    return this;
  }
  delete(name: string) {
    return this.#map.delete(name.toLowerCase());
  }
  *[Symbol.iterator](): Generator<[string, string]> {
    for (const [k, v] of [...this.#map].sort(([a], [b]) => (a < b ? -1 : 1))) yield [k,
      v.join(", ")];
  }
}
class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly headers: Record<string,
    string> = {}) {
    super(message);
    this.name = new.target.name;
  }
}
class NotFound extends HttpError {
  constructor(path: string) {
    super(404, "nothing at " + path);
  }
}
class NotAllowed extends HttpError {
  constructor(allowed: Method[]) {
    super(405, "allowed: " + allowed.join(), { allow: allowed.join() });
  }
}
class Request2 {
  readonly path: string;
  readonly query: ReadonlyMap<string, string[]>;
  readonly headers: Headers2;
  constructor(readonly method: Method, readonly url: string,
    readonly body: string | null = null, headers: Record<string, string> = {}) {
    const at = url.indexOf("?");
    this.path = at < 0 ? url : url.slice(0, at);
    const query = new Map<string, string[]>();
    if (at >= 0) for (const part of url.slice(at + 1).split("&")) {
      if (!part) continue;
      const [k, v = ""] = part.split("=").map(s => decodeURIComponent(s.replace(/\+/g, " ")));
      const list = query.get(k);
      if (list) list.push(v);
      else query.set(k, [v]);
    }
    this.query = query;
    this.headers = new Headers2(headers);
  }
  json<T>(): T {
    if (this.body === null) throw new HttpError(400, "no body");
    try {
      return JSON.parse(this.body) as T;
  } catch {
      throw new HttpError(400, "bad json");
    }
  }
}
class Response2 {
  readonly headers: Headers2;
  constructor(readonly status: number, readonly body: string, headers: Record<string,
    string> = {}) {
    this.headers = new Headers2(headers);
  }
  static json(value: unknown, status = 200) {
    return new Response2(status, JSON.stringify(value), { "content-type": "application/json" });
  }
  static text(text: string, status = 200) {
    return new Response2(status, text, { "content-type": "text/plain" });
  }
  with(status: number, body = this.body) {
    const r = new Response2(status, body);
    for (const [k, v] of this.headers) r.headers.set(k, v);
    return r;
  }
  toString() {
    return `${this.status} ${[...this.headers].map(h => h.join(": ")).join("; ")} ${this.body}`;
  }
}
class Context<S extends object = {
}
> {
  readonly state: S;
  params: Params = {
};
  readonly trail: string[] = [];
  constructor(readonly request: Request2, readonly app: Router<S>, state: S) {
    this.state = state;
  }
  param(name: string): string {
    const v = this.params[name];
    if (v === undefined) throw new HttpError(500, "no parameter " + name);
    return v;
  }
  int(name: string): number {
    const n = Number(this.param(name));
    if (!Number.isInteger(n)) throw new HttpError(400, `${name} must be a whole number`);
    return n;
  }
}
type Handler<S extends object> = (c: Context<S>) => Response2;
type Middleware<S extends object> = (c: Context<S>, next: () => Response2) => Response2;
type Segment = {
  kind: "static";
  text: string
} | {
  kind: "param";
  name: string;
  pattern: RegExp | null
} | {
  kind: "rest";
  name: string
};
class Node<S extends object> {
  readonly statics = new Map<string, Node<S>>();
  readonly params: {
    name: string;
    pattern: RegExp | null;
    node: Node<S>
}[] = [];
  rest: {
    name: string;
    node: Node<S>
} | null = null;
  readonly handlers = new Map<Method, {
    run: Handler<S>;
    label: string
  }
  >();
  *walk(path = ""): Generator<string> {
    for (const [m, h] of this.handlers) yield `${m} ${path || "/"} -> ${h.label}`;
    for (const [text, n] of this.statics) yield* n.walk(path + "/" + text);
    for (const p of this.params) yield* p.node.walk(`${path}/:${p.name}${p.pattern ? "(" + p.pattern.source + ")" : ""}`);
    if (this.rest) yield* this.rest.node.walk(`${path}/*${this.rest.name}`);
  }
}
class Router<S extends object = {
}
> {
  readonly #root = new Node<S>();
  readonly #middleware: {
    prefix: string;
    run: Middleware<S>
}[] = [];
  readonly #errors: ((e: Error, c: Context<S>) => Response2 | null)[] = [];
  visited = 0;
  served = 0;
  constructor(readonly makeState: () => S) {
  }
  static segments(path: string): Segment[] {
    return path.split("/").filter(Boolean).map((part): Segment => {
      if (part[0] === "*") return {
        kind: "rest", name: part.slice(1) || "rest"
    };
      const m = /^:(\w+)(?:\((.*)\))?$/.exec(part);
      return m ? {
        kind: "param", name: m[1], pattern: m[2] ? new RegExp(`^(?:${m[2]})$`) : null
    } : {
        kind: "static", text: part
    };
  });
  }
  on(method: Method, path: string, run: Handler<S>, label = path): this {
    let node = this.#root;
    for (const s of Router.segments(path)) {
      switch (s.kind) {
        case "static": {
          let next = node.statics.get(s.text);
          if (!next) node.statics.set(s.text, (next = new Node<S>()));
          node = next;
          break;
        }
        case "param": {
          let p = node.params.find(x => x.name === s.name &&
            x.pattern?.source === s.pattern?.source);
          if (!p) {
            p = {
              name: s.name, pattern: s.pattern, node: new Node<S>()
          };
            node.params.push(p);
            node.params.sort((a, b) => Number(b.pattern !== null) - Number(a.pattern !== null));
          }
          node = p.node;
          break;
        }
        case "rest": node.rest ??= {
          name: s.name, node: new Node<S>()
      };
        node = node.rest.node;
      }
    }
    if (node.handlers.has(method)) throw new TypeError(`${method} ${path} twice`);
    node.handlers.set(method, { run, label });
    return this;
  }
  get = (path: string, run: Handler<S>, label?: string) => this.on("GET", path, run, label);
  post = (path: string, run: Handler<S>, label?: string) => this.on("POST", path, run, label);
  use(prefix: string, run: Middleware<S>): this {
    this.#middleware.push({ prefix, run });
    return this;
  }
  error(f: (e: Error, c: Context<S>) => Response2 | null): this {
    this.#errors.push(f);
    return this;
  }
  mount(prefix: string, build: (r: { on: (m: Method, p: string,
    h: Handler<S>) => void }) => void): this {
    build({ on: (m, p, h) => this.on(m, prefix + p, h) });
    return this;
  }
  #find(node: Node<S>, parts: string[], i: number, params: Record<string,
    string>): Node<S> | null {
    this.visited++;
    if (i === parts.length) return node.handlers.size ? node : node.rest?.node.handlers.size ? ((params[node.rest.name] = ""),
      node.rest.node) : null;
    const part = parts[i];
    const fixed = node.statics.get(part);
    if (fixed) {
      const found = this.#find(fixed, parts, i + 1, params);
      if (found) return found;
    }
    for (const p of node.params) {
      if (p.pattern && !p.pattern.test(part)) continue;
      const before = params[p.name];
      params[p.name] = decodeURIComponent(part);
      const found = this.#find(p.node, parts, i + 1, params);
      if (found) return found;
      if (before === undefined) delete params[p.name];
      else params[p.name] = before;
    }
    if (node.rest) {
      params[node.rest.name] = parts.slice(i).join("/");
      return node.rest.node;
    }
    return null;
  }
  handle(request: Request2): Response2 {
    this.served++;
    const c = new Context<S>(request, this, this.makeState());
    const stack = this.#middleware.filter(m => request.path.startsWith(m.prefix));
    const dispatch = (i: number): Response2 => {
      if (i < stack.length) {
        let called = false;
        return stack[i].run(c, () => {
          if (called) throw new Error("next() twice");
          called = true;
          return dispatch(i + 1);
      });
      }
      const params: Record<string, string> = {
    };
      const node = this.#find(this.#root, request.path.split("/").filter(Boolean), 0, params);
      if (!node) throw new NotFound(request.path);
      const h = node.handlers.get(request.method);
      if (!h) throw new NotAllowed([...node.handlers.keys()].sort());
      c.params = params;
      c.trail.push(h.label);
      return h.run(c);
  };
    try {
      return dispatch(0);
  } catch (e) {
      for (const f of this.#errors) {
        const r = f(e as Error, c);
        if (r) return r;
      }
      if (e instanceof HttpError) {
        const r = Response2.json({ error: e.message, kind: e.name }, e.status);
        for (const k in e.headers) r.headers.set(k, e.headers[k]);
        return r;
      }
      return Response2.text("internal: " + (e as Error).message, 500);
    }
  }
  routes() {
    return [...this.#root.walk()];
  }
}
interface State {
  user: string | null;
  started: number
}
interface Note {
  id: number;
  text: string;
  by: string;
  version: number
}
const notes = new Map<number, Note>();
let nextId = 1, clock = 0;
const log: string[] = [];
const app = new Router<State>(() => ({ user: null, started: ++clock }));
app.use("/", (c, next) => {
  const r = next();
  log.push(`${c.request.method} ${c.request.path} ${r.status} ${c.trail.join(">")}`);
  r.headers.set("x-n", String(c.state.started));
  return r;
}).use("/api", (c, next) => {
  const token = c.request.headers.get("Authorization");
  if (!token) throw new HttpError(401, "who are you");
  c.state.user = token.replace("Bearer ", "");
  c.trail.push("auth");
  return next();
}).use("/api/notes", (c, next) => {
  const r = next();
  return c.request.headers.get("if-none-match") === `"${r.body.length}"` ? r.with(304, "") : r;
});
app.get("/", () => Response2.text("home")).get("/files/*path",
  c => Response2.text("file " + c.param("path"))).get("/files/special",
  () => Response2.text("special")).get("/d/:y(\\d{4})/:m(\\d\\d)",
  c => Response2.json(c.params)).get("/d/:name/:rest",
  c => Response2.text(`named ${c.param("name")} ${c.param("rest")}`)).get("/search",
  c => Response2.json([...c.request.query])).get("/boom", () => {
  throw new TypeError("boom");
}).mount("/api/notes", r => {
  r.on("GET", "",
    c => Response2.json([...notes.values()].filter(n => !c.request.query.has("by") ||
    c.request.query.get("by")!.includes(n.by)).map(n => n.id)));
  r.on("POST", "", c => {
    const {
      text
  } = c.request.json<{
      text: string
    }
    >();
    if (!text) throw new HttpError(422, "empty");
    const n: Note = {
      id: nextId++, text, by: c.state.user!, version: 1
  };
    notes.set(n.id, n);
    return Response2.json(n, 201);
});
  r.on("GET", "/:id(\\d+)", c => {
    const n = notes.get(c.int("id"));
    if (!n) throw new NotFound(c.request.path);
    return Response2.json(n);
});
  r.on("PUT", "/:id(\\d+)", c => {
    const n = notes.get(c.int("id"));
    if (!n) throw new NotFound(c.request.path);
    Object.assign(n, c.request.json<Partial<Note>>(), { version: n.version + 1 });
    return Response2.json(n);
});
  r.on("DELETE", "/:id", c => Response2.json(notes.delete(c.int("id"))));
});
app.error(e => (e instanceof TypeError ? Response2.text("type: " + e.message, 599) : null));
const auth = {
  Authorization: "Bearer ann"
};
const requests: [Method, string, string | null, Record<string, string>][] = [["GET", "/", null,
  {}], ["GET", "/files/a/b%20c.txt", null, {}], ["GET", "/files/special", null, {}], ["GET",
  "/files", null, {}], ["GET", "/d/2026/11", null, {}], ["GET", "/d/2026/x", null, {}], ["GET",
  "/d/a%2Fb/c", null, {}], ["GET", "/search?q=a+b&q=%C3%A9&empty&x=1=2", null, {}], ["GET",
  "/api/notes", null, {}], ["POST", "/api/notes", '{"text":"first"}', auth], ["POST",
  "/api/notes", "{", auth], ["POST", "/api/notes", null, auth], ["POST", "/api/notes",
  '{"text":""}', auth], ["GET", "/api/notes/1", null, auth], ["PUT", "/api/notes/1",
  '{"text":"changed"}', { Authorization: "Bearer bob" }], ["GET", "/api/notes?by=ann&by=bob",
  null, auth], ["GET", "/api/notes/99", null, auth], ["DELETE", "/api/notes/x", null, auth],
  ["DELETE", "/api/notes/1", null, auth], ["PUT", "/search", null, {}], ["GET", "/boom", null,
  {}], ["GET", "/none/here", null, {}], ["GET", "/api/notes", null, { ...auth,
  "If-None-Match": '"2"' }]];
let mixed = 0;
for (let round = 0; round < 400; round++) for (const [m, url, body, headers] of requests) {
  const text = String(app.handle(new Request2(m, url, body, headers)));
  if (round === 0) console.log(m, url, "=>", text);
  mixed = (mixed * 31 + text.length + text.charCodeAt(text.length - 1 - (round % 5))) >>> 0;
}
console.log(app.routes().join("\n"));
console.log(mixed, app.served, app.visited, log.length, log.slice(9, 12).join(" | "));
try {
  app.get("/", () => Response2.text("again"));
} catch (e) {
  console.log((e as Error).message);
}
