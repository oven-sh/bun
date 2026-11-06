// process.env, Bun.env and import.meta.env are one object. It holds strings alone: whatever is stored or defined is made a string, by code that only the object calls.
const say = (...values: unknown[]) => console.log(...values);
if (process.env.IS_THE_CHILD) { say(process.env.CONVERTED, process.env.NUMBER); process.exit(0); }
const env = process.env as Record<string, any>;
say(process.env === Bun.env, process.env === import.meta.env, typeof env.PATH, env.NOBODY_HAS_SET_THIS, typeof env.toString, env.constructor === Object, "PATH" in env, "NOBODY_HAS_SET_THIS" in env);
env.TEXT = "text"; env.NUMBER = 1.5; env.FLAG = true; say(env.TEXT, env.NUMBER, typeof env.NUMBER, env.FLAG, typeof env.FLAG, Bun.env.TEXT, import.meta.env.TEXT);
env.CONVERTED = { toString() { say("toString ran"); return "from toString"; } }; say(env.CONVERTED, typeof env.CONVERTED);
env.PRIMITIVE = { [Symbol.toPrimitive](hint: string) { say("toPrimitive ran with", hint); return 7; } }; say(env.PRIMITIVE, typeof env.PRIMITIVE);
env.VALUE = { toString: undefined, valueOf() { say("valueOf ran"); return "from valueOf"; } }; say(env.VALUE);
env.NOTHING = undefined; env.NULL = null; env.LIST = [1, [2, 3]]; env.BIG = 10n; say(env.NOTHING, typeof env.NOTHING, env.NULL, typeof env.NULL, env.LIST, env.BIG);
env[7] = { toString: () => "under an index" }; say(env[7], env["7"], typeof env[7]);
const key = ["COM", "PUTED"].join(""); env[key] = { toString: () => "under a computed key" }; say(env.COMPUTED, env[key].length);
Object.defineProperty(env, "DEFINED", { value: { toString: () => "defined" }, writable: true, enumerable: true, configurable: true }); say(env.DEFINED, typeof env.DEFINED);
Object.assign(env, { ASSIGNED: { toString: () => "assigned" } }); say(env.ASSIGNED, typeof env.ASSIGNED);
say(Reflect.set(env, "REFLECTED", { toString: () => "reflected" }), env.REFLECTED, typeof env.REFLECTED);
for (const refused of [() => { env.SYMBOL = Symbol("s"); }, () => { env[Symbol("key") as any] = "x"; }, () => { env.THROWS = { toString() { throw new RangeError("from toString"); } }; }, () => Object.defineProperty(env, "ACCESSOR", { get: () => 1 }), () => Object.defineProperty(env, "HIDDEN", { value: "x" })])
  try { refused(); say("no error"); } catch (e) { say((e as Error).name, (e as any).code); }
say(delete env.TEXT, env.TEXT, "TEXT" in env, Object.keys(env).includes("NUMBER"), Object.entries(env).every(([name, value]) => typeof name === "string" && typeof value === "string"));
const copy = { ...env }; say(copy.NUMBER, typeof copy.CONVERTED, JSON.parse(JSON.stringify(env)).LIST);
let strings = 0; for (const name in env) if (typeof env[name] === "string") strings++; say(strings === Object.keys(env).length);
env.TZ = "America/New_York"; say(env.TZ, new Date(0).getHours()); env.TZ = { toString: () => "UTC" }; say(env.TZ, new Date(0).getHours());
const heir = Object.create(env); const kept = { toString() { say("never run"); return ""; } }; heir.OWN = kept; say(heir.OWN === kept, env.OWN, heir.NUMBER);
say(Bun.spawnSync({ cmd: /[$~]bun/i.test(process.argv[1]!) ? [process.execPath] : [process.execPath, process.argv[1]!], env: { ...env, IS_THE_CHILD: "1" } }).stdout.toString().trim());
Object.setPrototypeOf(env, { INHERITED: () => "a function above the environment" }); say(env.INHERITED(), typeof env.toString, env.NUMBER); Object.setPrototypeOf(env, Object.prototype);
const replaced = { HOME: () => "a function of the program" }; (process as any).env = replaced; say((process.env as any).HOME(), process.env === (replaced as any), Bun.env === (replaced as any));
