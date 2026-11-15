import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const tls = `{ key: "a", cert: "b" }`;
const app = `class App { port = 0; fetch = () => new Response("first"); }`;
const literal = `{ port: 0, fetch() { return new Response("first"); } }`;

async function keptBy(text: string) {
  using dir = tempDir("aot-options-that-are-no-literal", { "main.ts": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.ts"],
    cwd: String(dir),
    env,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const lines = stderr.split("\n");
  return {
    exitCode,
    builtInsThatEscape: lines.filter(line => line.includes("(escapes, ")).length,
    keepsTls: lines.some(line => /^aot: trim: kept TLS(?: \([a-z0-9-]+\))?: used\b/.test(line)),
  };
}

async function served(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "inherit" });
  const decoder = new TextDecoder();
  let printed = "";
  for await (const chunk of proc.stdout) {
    printed += decoder.decode(chunk, { stream: true });
    const port = /localhost:(\d+)/.exec(printed)?.[1];
    if (!port) continue;
    const answer = await fetch(`http://localhost:${port}/made`, { method: "POST", body: "up" });
    return { printed: printed.replaceAll(port, "PORT"), status: answer.status, text: await answer.text() };
  }
  return { printed, status: 0, text: "" };
}

const started = (options: string) => `const server = Bun.serve(${options});\nserver.stop();`;
const tight = { exitCode: 0, builtInsThatEscape: 0, keepsTls: false };

describe.concurrent("options that are objects in sight are taken apart by their fields", () => {
  test.each([
    ["an instance", `${app}\n${started("new App()")}`],
    ["an instance of an heir", `${app}\nclass Heir extends App { hostname = "localhost"; }\n${started("new Heir()")}`],
    [
      "a spread of a literal in sight",
      `const base = { port: 0 };\n${started(`{ ...base, fetch() { return new Response("first"); } }`)}`,
    ],
    ["an instance that is exported by default", `${app}\nconst made = new App();\nexport default made;`],
    [
      "an instance that reads its request",
      `class App { port = 0; fetch = (request: Request) => new Response(new URL(request.url).pathname); }\nexport default new App();`,
    ],
    [
      "an instance that a method of its class has filled before it is exported",
      `class App {\n  port = 0;\n  table: Array<() => Response> = [];\n  add() { this.table.push(() => new Response("a")); }\n  fetch = () => this.table[0]!();\n}\nconst made = new App();\nmade.add();\nexport default made;`,
    ],
    [
      "an instance with a list under routes, which is passed over",
      `class App {\n  port = 0;\n  routes: Array<{ path: string; handler: () => Response }> = [];\n  add(path: string, handler: () => Response) { this.routes.push({ path, handler }); return this; }\n  fetch = (request: Request) => this.routes.find(({ path }) => request.method === path)?.handler() ?? new Response("none");\n}\nexport default new App().add("GET", () => new Response("found"));`,
    ],
    [
      "an instance with an empty list under routes, handed to Bun.serve",
      `class App { port = 0; routes: string[] = []; fetch = () => new Response(String(this.routes.length)); }\n${started("new App() as any")}`,
    ],
    [
      "a list under routes in a literal",
      started(`{ port: 0, routes: [] as any, fetch() { return new Response("first"); } }`),
    ],
    [
      "an instance whose other fields hold functions that answer the instance",
      `class App {\n  port = 0;\n  table: string[] = [];\n  get = (path: string) => { this.table.push("get" + path); return this; };\n  post = (path: string) => { this.table.push("post" + path); return this; };\n  fetch = () => new Response(this.table.join());\n}\nexport default new App().get("/a").post("/b");`,
    ],
    [
      "an instance whose handler is a method of its class",
      `class App { port = 0; fetch(request: Request) { return new Response("method " + request.method); } }\nexport default new App();`,
    ],
    [
      "an instance whose handlers are methods of the class above",
      `class Base { fetch(): Response { throw new Error("made up"); } error(caught: Error) { return new Response(caught.message); } }\nclass App extends Base { port = 0; }\n${started("new App() as any")}`,
    ],
    [
      "an instance without a handler, so that nothing is started",
      `class Config { name = "made up"; }\nexport default new Config();`,
    ],
  ])("%s", async (_, text) => {
    expect(await keptBy(text)).toEqual(tight);
  });

  test("a small router that reads the address of its request stays small", async () => {
    const kept = await keptBy(
      `class App {\n  port = 0;\n  table: Array<[string, (request: Request) => Response]> = [];\n  get(path: string, handler: (request: Request) => Response) { this.table.push([path, handler]); return this; }\n  fetch = (request: Request) => {\n    const path = new URL(request.url).pathname;\n    for (const [at, handler] of this.table) if (at === path) return handler(request);\n    return new Response("none", { status: 404 });\n  };\n}\nconst made = new App();\nmade.get("/a", () => new Response("a"));\nexport default made;`,
    );
    expect(kept).toMatchObject({ exitCode: 0, keepsTls: false });
    expect(kept.builtInsThatEscape).toBeLessThan(100);
  });

  test("an option that is a field keeps its feature", async () => {
    expect(
      await keptBy(
        `class App { port = 0; tls = ${tls}; fetch = () => new Response("first"); }\n${started("new App()")}`,
      ),
    ).toEqual({
      ...tight,
      keepsTls: true,
    });
  });
});

const roads: Array<[string, string, string]> = [
  [
    "a spread of what nobody knows",
    ``,
    `{ port: 0, ...JSON.parse(process.argv[2]!), fetch() { return new Response("first"); } }`,
  ],
  ["a store by name on a literal", `const options: any = ${literal};\noptions.tls = ${tls};`, `options`],
  [
    "a store under a key nobody knows on a literal",
    `const options: any = ${literal};\noptions[JSON.parse(JSON.stringify("tls"))] = ${tls};`,
    `options`,
  ],
  [
    "Object.assign of what nobody knows",
    `const options: any = ${literal};\nObject.assign(options, JSON.parse(process.argv[2]!));`,
    `options`,
  ],
  [
    "a store by name in a function on a literal behind a cast",
    `const options = ${literal} as { port: number; tls?: unknown };\nfunction change() { options.tls = ${tls}; }\nchange();`,
    `options`,
  ],
  [
    "a store by name in a function on a literal that satisfies a type",
    `const options = ${literal} satisfies { port: number; fetch(): Response };\nfunction change() { (options as any).tls = ${tls}; }\nchange();`,
    `options`,
  ],
  ["a store by name on an instance", `${app}\nconst made: any = new App();\nmade.tls = ${tls};`, `made`],
  [
    "a store under a key nobody knows on an instance",
    `${app}\nconst made: any = new App();\nmade[JSON.parse(JSON.stringify("tls"))] = ${tls};`,
    `made`,
  ],
  [
    "a store through a list nobody knows",
    `${app}\nconst made: any = new App();\nconst held: any[] = JSON.parse("[]");\nheld.push(made);\nheld[0][JSON.parse(JSON.stringify("tls"))] = ${tls};`,
    `made`,
  ],
  [
    "a store by name in a function that is handed the instance",
    `${app}\nfunction change(one: any) { one.tls = ${tls}; }\nconst made = new App();\nchange(made);`,
    `made`,
  ],
  [
    "a store by name in a method",
    `class App { port = 0; fetch = () => new Response("first"); secure() { (this as any).tls = ${tls}; } }\nconst made = new App();\nmade.secure();`,
    `made`,
  ],
  [
    "a getter of the class",
    `class App { port = 0; fetch = () => new Response("first"); get tls() { return ${tls}; } }`,
    `new App()`,
  ],
  [
    "a getter of the class above",
    `class Base { get tls() { return ${tls}; } }\nclass App extends Base { port = 0; fetch = () => new Response("first"); }`,
    `new App()`,
  ],
  ["a store on the prototype", `${app}\n(App.prototype as any).tls = ${tls};`, `new App()`],
  ["a prototype laid later", `${app}\nconst made = new App();\nObject.setPrototypeOf(made, { tls: ${tls} });`, `made`],
  [
    "an object created above another",
    `const made: any = Object.create({ tls: ${tls} });\nmade.port = 0;\nmade.fetch = () => new Response("first");`,
    `made`,
  ],
  [
    "a proxy",
    `${app}`,
    `new Proxy(new App(), { get(target: any, key) { return key === "tls" ? ${tls} : target[key]; } })`,
  ],
  [
    "Object.defineProperty",
    `${app}\nconst made = new App();\nObject.defineProperty(made, "tls", { value: ${tls} });`,
    `made`,
  ],
  ["Reflect.set", `${app}\nconst made = new App();\nReflect.set(made, "tls", ${tls});`, `made`],
  [
    "one of two objects",
    `${app}\nclass Secure { port = 0; tls = ${tls}; fetch = () => new Response("second"); }`,
    `process.argv.length > 2 ? new Secure() : new App()`,
  ],
];

describe.concurrent("an option may be laid on them by another road", () => {
  test.each(roads)("%s, handed to Bun.serve", async (_, before, options) => {
    expect(await keptBy(`${before}\n${started(`${options} as any`)}`)).toMatchObject({ exitCode: 0, keepsTls: true });
  });

  test.each(roads)("%s, exported by default", async (_, before, options) => {
    expect(await keptBy(`${before}\nexport default ${options};`)).toMatchObject({ exitCode: 0, keepsTls: true });
  });
});

const field = `class App { port = 0; fetch = (request: Request) => new Response("field " + request.method); }`;
const says = `console.log("http://localhost:" + server.port);`;

describe.concurrent("an executable answers as plain Bun does", () => {
  test.each([
    [
      "an instance whose handler reads its request, this and the server",
      `class App {\n  port = 0;\n  name = "made up";\n  fetch = async (request: Request, server: { port: number }) => new Response([this.name, request.method, new URL(request.url).pathname, await request.text(), typeof server.port].join(" "));\n}\nexport default new App();`,
    ],
    [
      "a method of the class, whose this is the server",
      `class App {\n  port = 0;\n  fetch(this: unknown, request: Request, server: unknown) { return new Response(String(this === server) + " " + request.method); }\n}\nexport default new App();`,
    ],
    [
      "a handler behind a getter of the class",
      `class App {\n  port = 0;\n  get fetch() { console.log("asked"); return () => new Response("by a getter"); }\n}\nexport default new App();`,
    ],
    [
      "a handler that is laid later",
      `${app}\nconst made = new App();\nmade.fetch = () => new Response("second");\nexport default made;`,
    ],
    [
      "a handler that a function lays later",
      `${app}\nfunction change(one: App) { one.fetch = () => new Response("second"); }\nconst made = new App();\nchange(made);\nexport default made;`,
    ],
    [
      "a handler of errors that a function lays on a literal behind a cast, exported under the name default",
      `type Options = { port: number; fetch(request: Request): Response; error?: (caught: Error) => Response };\nconst options = { port: 0, fetch(): Response { throw new Error("made up"); } } as Options;\nfunction lay() { options.error = caught => new Response("handled " + caught.message); }\nlay();\nexport { options as default };`,
    ],
    [
      "a handler of errors that a function lays on a literal that satisfies a type",
      `const options = { port: 0, fetch(): Response { throw new Error("made up"); } } satisfies { port: number; fetch(): Response };\nfunction lay() { (options as any).error = (caught: Error) => new Response("handled " + caught.message); }\nlay();\nexport default options;`,
    ],
    [
      "routes that a function lays on a literal behind a cast",
      `const options = { port: 0, fetch() { return new Response("first"); } } as any;\nfunction lay() { options.routes = { "/made": (request: Request) => new Response("route " + request.method) }; }\nlay();\nexport { options as default };`,
    ],
    [
      "a handler that an heir overrides",
      `${app}\nclass Heir extends App { fetch = () => new Response("of the heir"); }\nexport default new Heir();`,
    ],
    [
      "a handler of errors that is a field",
      `class App {\n  port = 0;\n  fetch = (): Response => { throw new Error("made up"); };\n  error = (caught: Error) => new Response(caught.message, { status: 200 });\n}\nexport default new App();`,
    ],
    [
      "routes that are a field",
      `class App {\n  port = 0;\n  routes = { "/made": (request: Request) => new Response("a route " + request.method) };\n  fetch = () => new Response("first");\n}\nexport default new App();`,
    ],
    [
      "a list under routes, which is passed over",
      `class App {\n  port = 0;\n  routes: Array<{ path: string; handler: () => Response }> = [];\n  add(path: string, handler: () => Response) { this.routes.push({ path, handler }); return this; }\n  fetch = (request: Request) => this.routes.find(({ path }) => new URL(request.url).pathname === path)?.handler() ?? new Response("none");\n}\nexport default new App().add("/made", () => new Response("found"));`,
    ],
    [
      "a list under routes that a record replaces before the start",
      `class App {\n  port = 0;\n  routes: any = [];\n  fetch = () => new Response("first");\n}\nconst made = new App();\nmade.routes = { "/made": (request: Request) => new Response("a route " + request.method) };\nexport default made;`,
    ],
    [
      "one of a list and a record under routes",
      `class App {\n  port = 0;\n  routes: any = process.argv.length > 5 ? [] : { "/made": (request: Request) => new Response("a route " + request.method) };\n  fetch = () => new Response("first");\n}\nexport default new App();`,
    ],
    [
      "one of a list and a record under routes in a literal",
      `const server = Bun.serve({ port: 0, routes: (process.argv.length > 5 ? [] : { "/made": (request: Request) => new Response("a route " + request.method) }) as any, fetch() { return new Response("first"); } });\n${says}`,
    ],
    [
      "a list under routes and a record under static",
      `class App {\n  port = 0;\n  routes: string[] = [];\n  static = { "/made": (request: Request) => new Response("static " + request.method) };\n  fetch = () => new Response("first");\n}\nexport default new App();`,
    ],
    [
      "an heir of Array under routes",
      `class Routes extends Array<string> {}\nclass App {\n  port = 0;\n  routes = new Routes();\n  fetch = () => new Response("first " + this.routes.length);\n}\nexport default new App();`,
    ],
    [
      "a list under routes whose members a handler calls",
      `class App {\n  port = 0;\n  routes: Array<(request: Request) => Response> = [request => new Response("called " + request.method)];\n  fetch = (request: Request) => this.routes[0]!(request);\n}\nexport default new App();`,
    ],
    [
      "an option that the server asks for holds a getter, which is asked",
      `class App {\n  port = 0;\n  development = { get hmr() { console.log("asked"); return false; } };\n  fetch = () => new Response("first");\n}\nexport default new App();`,
    ],
    [
      "a field that the server does not ask for holds a getter, which nobody asks",
      `class App {\n  port = 0;\n  other = { get hmr() { console.log("never"); return false; } };\n  fetch = () => new Response("first " + Object.keys(this.other).length);\n}\nexport default new App();`,
    ],
    [
      "fields that the server does not ask for hold functions that answer the instance",
      `class App {\n  port = 0;\n  table: string[] = [];\n  get = (path: string) => { this.table.push("get" + path); return this; };\n  post = (path: string) => { this.table.push("post" + path); return this; };\n  fetch = (request: Request) => new Response(this.table.join() + " " + request.method);\n}\nexport default new App().get("/a").post("/b");`,
    ],
    [
      "a field that the server does not ask for is changed by a handler and read by the next",
      `class App {\n  port = 0;\n  seen: string[] = [];\n  fetch = (request: Request) => { this.seen.push(request.method); return new Response(this.seen.join()); };\n}\nexport default new App();`,
    ],
    [
      "a small router that is filled before it is exported",
      `class App {\n  port = 0;\n  table: Array<[string, (request: Request) => Response]> = [];\n  get(path: string, handler: (request: Request) => Response) { this.table.push([path, handler]); return this; }\n  fetch = (request: Request) => {\n    for (const [at, handler] of this.table) if (request.url.endsWith(at)) return handler(request);\n    return new Response("none", { status: 404 });\n  };\n}\nconst made = new App();\nmade.get("/made", request => new Response("found " + request.method));\nexport default made;`,
    ],
    ["an instance handed to Bun.serve", `${app}\nconst server = Bun.serve(new App());\n${says}`],
    [
      "an instance handed over by map",
      `${field}\nconst [server] = [new App()].map(Bun.serve as any) as any[];\n${says}`,
    ],
    [
      "an instance handed over by Reflect.apply",
      `${field}\nconst server: any = Reflect.apply(Bun.serve, Bun, [new App()]);\n${says}`,
    ],
    [
      "one call that is handed a literal and an instance in turn",
      `${field}\nfunction start(options: any) { return Bun.serve(options); }\nstart({ port: 0, fetch() { return new Response("literal"); } }).stop(true);\nconst server = start(new App());\n${says}`,
    ],
    [
      "an own accessor laid over the field of the handler",
      `${field}\nconst made = new App();\nObject.defineProperty(made, "fetch", { get() { console.log("asked"); return (request: Request) => new Response("accessor " + request.method); } });\nconst server = Bun.serve(made);\n${says}`,
    ],
    [
      "an own accessor laid over the field of the handler of errors",
      `class App { port = 0; fetch = (): Response => { throw new Error("made up"); }; error = (caught: Error) => new Response("field " + caught.message); }\nconst made = new App();\nObject.defineProperty(made, "error", { get() { return (caught: Error) => new Response("accessor " + caught.message); } });\nconst server = Bun.serve(made);\n${says}`,
    ],
    [
      "an own accessor laid over the field of the port",
      `${field}\nconst made = new App();\nlet asked = 0;\nObject.defineProperty(made, "port", { get() { asked++; return 0; } });\nconst server = Bun.serve(made);\nconsole.log(asked > 0);\n${says}`,
    ],
    [
      "a field that is deleted, so that the prototype answers",
      `${field}\nclass Heir extends App {}\n(Heir.prototype as any).fetch = () => new Response("prototype");\nconst made: any = new Heir();\ndelete made.fetch;\nconst server = Bun.serve(made);\n${says}`,
    ],
    [
      "an instance handed to reload",
      `${field}\nclass Next { fetch = (request: Request) => new Response("next " + request.method); }\nconst server = Bun.serve(new App());\nserver.reload(new Next() as any);\n${says}`,
    ],
    [
      "a method, handed to Bun.serve",
      `class App { port = 0; fetch(request: Request) { return new Response("method " + request.method); } }\nconst server = Bun.serve(new App() as any);\n${says}`,
    ],
    [
      "a method of the class above, handed to Bun.serve",
      `class Base { fetch(request: Request) { return new Response("above " + request.method); } }\nclass App extends Base { port = 0; }\nconst server = Bun.serve(new App() as any);\n${says}`,
    ],
    [
      "a method that is replaced on the prototype, handed to Bun.serve",
      `class App { port = 0; fetch(request: Request) { return new Response("method " + request.method); } }\nApp.prototype.fetch = request => new Response("replaced " + request.method);\nconst server = Bun.serve(new App() as any);\n${says}`,
    ],
    [
      "a method that a store on the instance hides, handed to Bun.serve",
      `class App { port = 0; fetch(request: Request) { return new Response("method " + request.method); } }\nconst made = new App();\nmade.fetch = request => new Response("hidden by " + request.method);\nconst server = Bun.serve(made as any);\n${says}`,
    ],
    [
      "a method that an heir overrides and calls, handed to Bun.serve",
      `class Base { fetch(request: Request) { return new Response("base " + request.method); } }\nclass App extends Base { port = 0; fetch(request: Request) { return new Response("heir of " + typeof super.fetch + " " + request.method); } }\nconst server = Bun.serve(new App() as any);\n${says}`,
    ],
    [
      "an async method that reads the body, handed to Bun.serve",
      `class App { port = 0; async fetch(request: Request) { return new Response("read " + (await request.text())); } }\nconst server = Bun.serve(new App() as any);\n${says}`,
    ],
    [
      "a method that is deleted from the prototype, so that the one above answers",
      `class Base { fetch(request: Request) { return new Response("base " + request.method); } }\nclass App extends Base { port = 0; fetch(request: Request) { return new Response("never " + request.method); } }\ndelete (App.prototype as any).fetch;\nconst server = Bun.serve(new App() as any);\n${says}`,
    ],
    [
      "a getter, handed to Bun.serve",
      `class App { port = 0; get fetch() { return (request: Request) => new Response("getter " + request.method); } }\nconst server = Bun.serve(new App() as any);\n${says}`,
    ],
    [
      "a handler of errors that is a method, handed to Bun.serve",
      `class App { port = 0; fetch = (): Response => { throw new Error("made up"); }; error(caught: Error) { return new Response("error " + caught.message); } }\nconst server = Bun.serve(new App() as any);\n${says}`,
    ],
    [
      "routes behind a getter, handed to Bun.serve",
      `class App { port = 0; fetch = () => new Response("first"); get routes() { return { "/made": (request: Request) => new Response("route " + request.method) }; } }\nconst server = Bun.serve(new App() as any);\n${says}`,
    ],
    [
      "a handler appended by a function, handed to Bun.serve",
      `class App { port = 0; }\nfunction lay(one: any) { one.fetch = (request: Request) => new Response("laid " + request.method); }\nconst made: any = new App();\nlay(made);\nconst server = Bun.serve(made);\n${says}`,
    ],
    [
      "a handler stored on the prototype, handed to Bun.serve",
      `class App { port = 0; }\n(App.prototype as any).fetch = (request: Request) => new Response("prototype " + request.method);\nconst server = Bun.serve(new App() as any);\n${says}`,
    ],
    [
      "a spread of a literal in sight",
      `const base = { port: 0, fetch() { return new Response("of the base"); } };\nconst server = Bun.serve({ ...base });\n${says}`,
    ],
    [
      "a spread that a later member overrides",
      `const base = { port: 0, fetch() { return new Response("of the base"); } };\nconst server = Bun.serve({ ...base, fetch() { return new Response("later"); } });\n${says}`,
    ],
    [
      "a handler that prints what it is handed",
      `class App {\n  port = 0;\n  fetch = (request: Request) => { console.log(request.method, Object.keys(request).length); return new Response("printed"); };\n}\nexport default new App();`,
    ],
  ])("%s", async (_, text) => {
    using dir = tempDir("aot-options-that-are-no-literal-run", { "main.ts": text });
    const cwd = String(dir);
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "served"],
      cwd,
      env,
      stdout: "ignore",
      stderr: "inherit",
    });
    expect(await build.exited).toBe(0);
    const plain = await served([bunExe(), "main.ts"], cwd);
    expect(plain.status).toBe(200);
    expect(await served(["./served"], cwd)).toEqual(plain);
  });
});
