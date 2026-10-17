// The program adds named, required members to NodeJS.ProcessEnv, as everybody does. No real environment holds them all. A type with an index signature is a dictionary: a name declared beside the signature is what a read may expect, never a demand.
declare global { namespace NodeJS { interface ProcessEnv { APP_MODE: string; REQUEST_LIMIT_MS: string; MY_FLAG?: "0" | "1" } } }
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = f(); } catch (e) { r = "THROWS " + (e as Error).message.split(" (bun")[0].split("\n").join(" ~ "); } console.log(name + ": " + (typeof r === "string" ? r : JSON.stringify(r))); };
const only = (env: Record<string, string | undefined>) => Object.keys(env).filter(name => /^(X|Y|APP_MODE|REQUEST_LIMIT_MS|MY_FLAG)$/.test(name)).sort().map(name => name + "=" + env[name]).join();
for (const name of ["APP_MODE", "REQUEST_LIMIT_MS", "MY_FLAG", "X", "Y"]) delete (process.env as Record<string, string | undefined>)[name];
function withX(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv { return { ...base, X: "1" }; }
function fromProcess(): NodeJS.ProcessEnv { return { ...process.env, X: "1" }; }
function fromBun(): NodeJS.ProcessEnv { return { ...Bun.env, X: "1" }; }
function fresh(): NodeJS.ProcessEnv { const made: Record<string, string> = { X: "1" }; return made as NodeJS.ProcessEnv; }
function copied(): NodeJS.ProcessEnv { const copy = { ...process.env }; copy.Y = "2"; return copy; }
function assigned(): NodeJS.ProcessEnv { return Object.assign({}, process.env, { X: "1" }); }
function takes(env: NodeJS.ProcessEnv) { return only(env); }
row("a declared result, a spread of a parameter", () => only(withX(process.env)));
row("a declared result, a spread of process.env", () => only(fromProcess()));
row("a declared result, a spread of Bun.env", () => only(fromBun()));
row("as NodeJS.ProcessEnv", () => only(fresh()));
row("a copy, stored to, returned", () => only(copied()));
row("Object.assign", () => only(assigned()));
row("a spread of a spread", () => only(withX(withX(fromProcess()))));
row("into a variable", () => { const env: NodeJS.ProcessEnv = { ...process.env, X: "1" }; return only(env); });
row("an argument", () => takes({ ...process.env, X: "1" }));
row("process.env itself an argument", () => takes(process.env));
row("a required name that is not there is read", () => [typeof process.env.APP_MODE, typeof withX(process.env).APP_MODE, typeof fromProcess().REQUEST_LIMIT_MS]);
row("and used", () => { const env = fromProcess(); return [(env.APP_MODE ?? "none"), env.APP_MODE === "production", String(env.REQUEST_LIMIT_MS), Number(env.REQUEST_LIMIT_MS || 5)]; });
row("stored, read, deleted", () => { const env = fromProcess(); env.APP_MODE = "test"; const was = env.APP_MODE; delete (env as Record<string, string | undefined>).APP_MODE; return [was, typeof env.APP_MODE, "APP_MODE" in env]; });
row("handed to spawnSync({ env })", () => Bun.spawnSync({ cmd: ["/bin/sh", "-c", "echo $X $APP_MODE"], env: withX(process.env) }).stdout.toString().trim());
row("handed to spawnSync({ env }) as a literal", () => Bun.spawnSync({ cmd: ["/bin/sh", "-c", "echo $X $APP_MODE"], env: { ...process.env, X: "1" } }).stdout.toString().trim());
row("import.meta.env", () => { const env: NodeJS.ProcessEnv = { ...import.meta.env, X: "1" }; return only(env); });
row("a literal with every declared name", () => { const full: NodeJS.ProcessEnv = { APP_MODE: "test", REQUEST_LIMIT_MS: "1" }; full.X = "1"; return [only(full), only(withX(full)), takes(full)]; });
interface Table { [name: string]: number; total: number }
function table(more: Record<string, number>): Table { return { ...more } as Table; }
function tableOf(data: unknown): Table { return data as Table; }
row("a dictionary of the program's with a declared name: a cast", () => [JSON.stringify(table({ a: 1 })), Object.keys(table({ a: 1 })), table({ total: 3 }).total]);
row("a dictionary of the program's: data from outside", () => { const t = tableOf(JSON.parse('{"a":1}')); return [JSON.stringify(t), "total" in t, t.a]; });
row("a dictionary of the program's: a literal with the name", () => { const t: Table = { total: 1, b: 2 }; t.c = 3; return [JSON.stringify(t), t.total + t.b + t.c]; });
