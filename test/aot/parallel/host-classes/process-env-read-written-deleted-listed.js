// process.env from every side: read by name and by key, set and not set, written with what is no text, deleted, listed, copied, defined, frozen, and what a child process gets.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
if (process.env.AOT_TEST_IS_THE_CHILD) {
  console.log(process.env.AOT_TEST_SET, process.env.AOT_TEST_KEY_1, process.env.AOT_TEST_NEVER_SET);
  process.exit(0);
}
const out = [];
const show = value => (typeof value === "string" ? JSON.stringify(value) : String(value));
function byName() { return process.env.AOT_TEST_SET; }
function byNameAbsent() { return process.env.AOT_TEST_NEVER_SET; }
function byKey(key) { return process.env[key]; }
function attempt(work) { try { return show(work()); } catch (error) { return error.constructor.name + ": " + error.message; } }
process.env.AOT_TEST_SET = "first";
const before = Object.keys(process.env);
out.push(show(byName()), show(byNameAbsent()), show(byKey("AOT_TEST_SET")), show(byKey("AOT_TEST_" + "NEVER_SET")), typeof byKey("PATH"), before.includes("AOT_TEST_SET"), before.at(-1));
for (let round = 0; round < 3; round++) {
  for (const value of [1, 0, -0, 1.5, true, false, null, undefined, "", "text", 10n, [1, 2], { toString() { return "by toString " + round; } }]) {
    process.env.AOT_TEST_SET = value;
    process.env["AOT_TEST_KEY_" + round] = value;
    out.push(show(byName()), show(byKey("AOT_TEST_KEY_" + round)));
  }
  out.push(attempt(() => (process.env.AOT_TEST_SET = Symbol("no text"))), attempt(() => (process.env[Symbol.iterator] = "x")), attempt(() => process.env[Symbol.iterator]), attempt(() => (process.env.AOT_TEST_SET = { toString() { throw new RangeError("thrown"); } })), show(byName()));
  out.push("AOT_TEST_SET" in process.env, "AOT_TEST_NEVER_SET" in process.env, Object.hasOwn(process.env, "AOT_TEST_SET"), "toString" in process.env, typeof process.env.toString, typeof process.env.hasOwnProperty);
  out.push(JSON.stringify(Object.getOwnPropertyDescriptor(process.env, "AOT_TEST_SET")), show(Object.getOwnPropertyDescriptor(process.env, "AOT_TEST_NEVER_SET")));
  out.push(delete process.env.AOT_TEST_SET, show(byName()), show(byKey("AOT_TEST_SET")), "AOT_TEST_SET" in process.env, delete process.env.AOT_TEST_SET, delete process.env.AOT_TEST_NEVER_SET, Object.keys(process.env).includes("AOT_TEST_SET"));
  process.env.AOT_TEST_SET = "again " + round;
  out.push(show(byName()), Object.keys(process.env).at(-1), Object.keys(process.env).filter(key => key.startsWith("AOT_TEST_")).join());
  out.push(attempt(() => Object.defineProperty(process.env, "AOT_TEST_DEFINED", { value: "defined", writable: true, enumerable: true, configurable: true }) === process.env), show(byKey("AOT_TEST_DEFINED")));
  out.push(attempt(() => Object.defineProperty(process.env, "AOT_TEST_GETTER", { get() { return 1; }, configurable: true })), attempt(() => Object.defineProperty(process.env, "AOT_TEST_HIDDEN", { value: "x", writable: true, enumerable: false, configurable: true })), show(byKey("AOT_TEST_GETTER")));
  process.env[7] = "seven";
  process.env["08"] = "eight";
  process.env[""] = "empty";
  out.push(show(process.env[7]), show(byKey("7")), show(byKey("08")), show(byKey("")), Object.keys(process.env).includes("7"), delete process.env[7], show(process.env[7]), delete process.env["08"]);
  const copy = { ...process.env };
  const listed = [];
  for (const key in process.env) if (key.startsWith("AOT_TEST_")) listed.push(key + "=" + process.env[key]);
  out.push(show(copy.AOT_TEST_SET), Object.keys(copy).length === Object.keys(process.env).length, listed.join(), Object.entries(process.env).filter(([key]) => key.startsWith("AOT_TEST_")).length, JSON.parse(JSON.stringify(process.env)).AOT_TEST_SET);
  const below = Object.create(process.env);
  below.AOT_TEST_BELOW = 5;
  out.push(show(below.AOT_TEST_SET), show(below.AOT_TEST_BELOW), show(byKey("AOT_TEST_BELOW")));
  delete process.env.AOT_TEST_DEFINED;
}
const zone = process.env.TZ;
process.env.TZ = "Asia/Tokyo";
out.push(show(process.env.TZ), new Date(0).getHours(), Object.keys(process.env).includes("TZ"));
process.env.TZ = "UTC";
out.push(show(process.env.TZ), new Date(0).getHours(), delete process.env.TZ, show(process.env.TZ), "TZ" in process.env);
if (zone !== undefined) process.env.TZ = zone;
out.push(attempt(() => Object.freeze(process.env)), attempt(() => Object.isFrozen(process.env)), attempt(() => Object.preventExtensions(process.env) === process.env));
out.push(attempt(() => (process.env.AOT_TEST_BEHIND = "stored")), show(byKey("AOT_TEST_BEHIND")));
const child = Bun.spawnSync({ cmd: /[$~]bun/i.test(process.argv[1]) ? [process.execPath] : [process.execPath, process.argv[1]], env: { ...process.env, AOT_TEST_IS_THE_CHILD: "1" } });
out.push(child.stdout.toString().trim());
const replaced = process.env;
process.env = { AOT_TEST_SET: "of a plain object" };
out.push(show(byName()), show(byNameAbsent()), show(byKey("PATH")), Object.keys(process.env).join());
process.env = replaced;
out.push(show(byName()), typeof byKey("PATH"));
console.log(out.join(" | "));
