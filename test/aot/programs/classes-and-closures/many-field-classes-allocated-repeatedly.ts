// A class with more fields than fit in its objects' cells: private and public ones, some left undefined, a dozen arrow functions. Made often enough for every cache to settle,
// then looked at from outside: keys and their order, values, what the arrow functions see.
type Options = { env: object; path: string; handler?: (c: Context) => string };

class Context {
  #request: { url: string };
  #cached: { path: string } | undefined;
  env: object = {};
  #variables: Map<string, unknown> | undefined;
  finalized: boolean = false;
  error: Error | undefined;
  #status: number | undefined;
  #answer: string | undefined;
  #layout: ((text: string) => string) | undefined;
  #handler: ((c: Context) => string) | undefined;
  #headers: Map<string, string> | undefined;
  #path: string | undefined;
  late?: string;

  constructor(request: { url: string }, options?: Options) {
    this.#request = request;
    if (options) {
      this.env = options.env;
      this.#handler = options.handler;
      this.#path = options.path;
    }
  }

  get cached(): { path: string } {
    return (this.#cached ??= { path: this.#path ?? "none" });
  }
  render = (text: string): string => (this.#layout ? this.#layout(text) : text);
  setLayout = (layout: (text: string) => string) => (this.#layout = layout);
  getLayout = () => this.#layout;
  header = (name: string, value: string | undefined): void => {
    const headers = (this.#headers ??= new Map());
    if (value === undefined) headers.delete(name);
    else headers.set(name, value);
  };
  status = (status: number): void => {
    this.#status = status;
  };
  set = (key: string, value: unknown): void => {
    (this.#variables ??= new Map()).set(key, value);
  };
  get = (key: string): unknown => this.#variables?.get(key);
  text = (text: string, status?: number): string => (this.#answer = (status ?? this.#status ?? 200) + " " + text + " " + (this.#headers?.size ?? 0));
  json = (value: unknown, status?: number): string => this.text(JSON.stringify(value), status);
  html = (html: string): string => this.text("<p>" + html + "</p>");
  url = (): string => this.#request.url;
  answer = (): string | undefined => this.#answer;
  notFound = (): string => (this.#handler ? this.#handler(this) : this.text("not found", 404));
}

class Wider extends Context {
  extra: number[] = [];
  #secret = "s";
  more = (n: number): number => this.extra.push(n) + this.#secret.length;
  tail: string | undefined;
}

const request = { url: "http://localhost/hello" };
const env = { name: "env" };
let checksum = 0;
for (let turn = 0; turn < 3000; turn++) {
  const c = turn % 3 === 0 ? new Context(request) : turn % 3 === 1 ? new Context(request, { env, path: "/p" + (turn & 3) }) : new Wider(request, { env, path: "/w", handler: c => c.text("handled", 410) });
  if (turn % 5 === 0) c.header("a", "b");
  if (turn % 7 === 0) c.status(201);
  if (turn % 11 === 0) c.set("k", turn);
  if (turn % 13 === 0) c.late = "late";
  checksum += c.json({ turn }).length + c.notFound().length + c.cached.path.length + Object.keys(c).length + (c.get("k") === turn ? 1 : 0) + (c instanceof Wider ? c.more(turn) : 0);
}
console.log(checksum);

function show(label: string, c: Context) {
  console.log(label, Object.keys(c).join(","));
  console.log(label, JSON.stringify(c), c.finalized, c.error?.message, c.late, typeof c.json, c.url(), c.answer());
}
show("bare", new Context(request));
show("with options", new Context(request, { env, path: "/x" }));
const wide = new Wider(request, { env, path: "/y" });
wide.more(4);
show("wider", wide);

const changed = new Context(request, { env, path: "/z" });
changed.late = "now";
delete (changed as { error?: Error }).error;
changed.error = new Error("again");
show("a key deleted and made again", changed);
(changed as unknown as Record<string, unknown>).added = 1;
changed.finalized = true;
show("a key nobody declared", changed);

const detached = new Context(request, { env, path: "/d" }).json;
console.log(detached([1, 2, 3], 202));

const frozen = new Context(request);
Object.freeze(frozen);
try {
  frozen.late = "no";
} catch (error) {
  console.log((error as Error).constructor.name);
}
show("frozen", frozen);
console.log(Object.getOwnPropertyNames(new Wider(request)).length, Reflect.ownKeys(new Context(request)).length);
for (const key in new Context(request, { env, path: "/k" })) if (key.length < 4) console.log(key);
