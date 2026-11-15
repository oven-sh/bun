"use strict";
const env = process.env, before = Object.getPrototypeOf(env);
function attempt(work) { try { return String(work()); } catch (error) { return error.name + " " + (error.code ?? ""); } }
const prototypes = { object: {}, empty: Object.create(null), list: [], instance: new (class { get kind() { return "instance"; } })(), proxy: new Proxy({}, {}), below: Object.create({ inherited: 1 }), above: Object.create(before), none: null, first: before };
let turn = 0;
for (const name in prototypes) {
  Object.setPrototypeOf(env, prototypes[name]);
  const key = "ENV_" + turn++, words = [];
  words.push(attempt(() => env[key] = 5), attempt(() => env[key]), attempt(() => Object.hasOwn(env, key)), attempt(() => env[key] = "again"), attempt(() => env[key]));
  words.push(attempt(() => env[turn] = 7), attempt(() => env[turn]), attempt(() => Object.hasOwn(env, String(turn))));
  words.push(attempt(() => Object.defineProperty(env, key + "D", { value: 1, configurable: true, writable: true, enumerable: true })[key + "D"]), attempt(() => Object.defineProperty(env, key + "E", { value: 1 })));
  words.push(attempt(() => Object.assign(env, { [key + "A"]: true })[key + "A"]), attempt(() => Reflect.set(env, key + "R", "r")), attempt(() => env[key + "R"]), attempt(() => env[Symbol()] = 1), attempt(() => env.TZ = "UTC"), attempt(() => env.HTTP_PROXY = ""), attempt(() => env[""] = 3), attempt(() => "" in env));
  words.push(attempt(() => { const heir = Object.create(env); heir[key + "H"] = 4; return [Object.hasOwn(heir, key + "H"), key + "H" in env, typeof heir[key + "H"]]; }));
  words.push(attempt(() => delete env[key]), attempt(() => key in env), attempt(() => Object.keys(env).filter(k => k.startsWith("ENV_" + (turn - 1))).join()));
  for (const k of Object.keys(env)) if (k.startsWith("ENV_")) delete env[k];
  console.log(name, words.join(" | "));
}
Object.setPrototypeOf(env, Object.create(null, { SETTER: { set(value) { this.SEEN = value; } }, LOCKED: { value: 1 } }));
console.log(attempt(() => { env.SETTER = 2; return env.SEEN + typeof env.SEEN; }), attempt(() => env.LOCKED = 3), attempt(() => Object.hasOwn(env, "LOCKED")));
Object.setPrototypeOf(env, before);
