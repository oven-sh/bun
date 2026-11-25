// `process.env`, `process.argv`, `process.versions`: the host makes the value at the first read and keeps it. A program that stores another one reads that one.
function environment() { return process.env; }
function argumentsOfRun() { return process.argv; }
const first = environment();
console.log(typeof first, first === environment(), first === process.env);
process.env.PRIVATE_NAMES_PROBE = "set";
console.log(environment().PRIVATE_NAMES_PROBE, process.env.PRIVATE_NAMES_PROBE, "PRIVATE_NAMES_PROBE" in environment());
delete process.env.PRIVATE_NAMES_PROBE;
console.log(environment().PRIVATE_NAMES_PROBE, Object.hasOwn(process.env, "PRIVATE_NAMES_PROBE"));
console.log(Array.isArray(argumentsOfRun()), argumentsOfRun() === process.argv, argumentsOfRun().length >= 1);
console.log(typeof process.versions, process.versions === process.versions, typeof process.versions.bun);
console.log(typeof process.pid, process.pid === process.pid, typeof process.platform, typeof process.arch);
for (let round = 0; round < 3; round++) { let same = 0; for (let i = 0; i < 100; i++) same += environment() === first ? 1 : 0; console.log(same); }
