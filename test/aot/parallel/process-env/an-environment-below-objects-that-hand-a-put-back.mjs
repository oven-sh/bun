const env = process.env, before = Object.getPrototypeOf(env);
function attempt(work) { try { return String(work()); } catch (error) { return error.name; } }
class Named { get kind() { return "instance"; } set LATE(value) { this.SEEN_LATE = value + "!"; } }
const prototypes = {
  literal: { m: 1 }, empty: {}, instance: new Named(), accessor: { set LATE(value) { this.SEEN_LATE = value + "?"; }, get READ() { return 1; } }, frozen: Object.freeze({ LOCKED: 1, m: 2 }), data: { SHARED: 1, 7: "seven" },
  list: [], function() {}, arrow: () => 1, proxy: new Proxy({}, {}), prototype: Object.create(Named.prototype), map: new Map(), error: new Error("e"), date: new Date(0), meta: import.meta.env,
  belowList: Object.setPrototypeOf({ m: 1 }, []), belowLiteral: Object.setPrototypeOf({ m: 1 }, { n: 2 }), belowProxy: Object.setPrototypeOf({ m: 1 }, new Proxy({}, {})), belowNothing: Object.setPrototypeOf({ m: 1 }, null),
};
let turn = 0;
for (const name in prototypes) {
  const words = [attempt(() => Object.setPrototypeOf(env, prototypes[name]) === env)], key = "HAND_" + turn++;
  words.push(attempt(() => env[key] = 5), attempt(() => env[key] + typeof env[key]), attempt(() => Object.hasOwn(env, key)), attempt(() => env[key] = "again"), attempt(() => env[key]));
  words.push(attempt(() => env[7] = 7), attempt(() => env[7] + typeof env[7]), attempt(() => Object.hasOwn(env, "7")));
  for (const each of ["LATE", "READ", "LOCKED", "SHARED", "m"]) words.push(each, attempt(() => env[each] = 2), attempt(() => Object.hasOwn(env, each)), attempt(() => env[each] + typeof env[each]), attempt(() => env["SEEN_" + each]));
  words.push(attempt(() => Object.defineProperty(env, key + "D", { value: 1, configurable: true, writable: true, enumerable: true })[key + "D"]), attempt(() => Object.assign(env, { [key + "A"]: true })[key + "A"]), attempt(() => Reflect.set(env, key + "R", "r")), attempt(() => env[key + "R"]));
  words.push(attempt(() => env[""] = 1), attempt(() => env[Symbol.iterator] = 1), attempt(() => env.TZ = "UTC"), attempt(() => env.NO_PROXY = "none"), attempt(() => env.NO_PROXY));
  words.push(attempt(() => { const heir = Object.create(env); heir[key + "H"] = 4; return [Object.hasOwn(heir, key + "H"), key + "H" in env, typeof heir[key + "H"]]; }));
  console.log(name, words.join(" | "));
  Object.setPrototypeOf(env, before);
  for (const each of Object.keys(env)) if (/^(HAND_|SEEN_|LATE$|READ$|LOCKED$|SHARED$|m$|7$|NO_PROXY$)/.test(each)) delete env[each];
}
console.log(Object.keys(env).filter(each => each.startsWith("HAND_")).length);
