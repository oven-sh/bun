import { bench, run } from "../runner.mjs";

// What a program does before the code that is measured here runs:
// a copy for a child process, which reads every variable,
globalThis.childEnv = { ...process.env };
// a feature flag that is checked often,
for (let n = 0; n < 20_000; n++) globalThis.flag = process.env.NOT_SET_FLAG;
// and dotenv-style writes.
for (const key of ["BENCH_A", "BENCH_B", "BENCH_C"]) process.env[key] = "1";
delete process.env.BENCH_C;

const keys = ["HOME", "PATH", "BENCH_A", "NOT_SET_1", "NOT_SET_2", "USER", "NOT_SET_3", "BENCH_B"];
let i = 0;

bench("process.env.HOME", () => process.env.HOME);
bench("process.env.NOT_SET", () => process.env.NOT_SET);
bench("process.env[key]", () => process.env[keys[i++ & 7]]);
bench("process.env.BENCH_A = 'value'", () => {
  process.env.BENCH_A = "value";
});
bench("{ ...process.env }", () => ({ ...process.env }));
bench("Object.keys(process.env)", () => Object.keys(process.env));
bench("process.argv", () => process.argv);
bench("process.argv[1]", () => process.argv[1]);
bench("process.argv.length", () => process.argv.length);
bench("process.execArgv", () => process.execArgv);

await run();
