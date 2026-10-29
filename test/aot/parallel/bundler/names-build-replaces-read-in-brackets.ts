// NODE_ENV is "production" where the program runs and not set where it is built. `bun build --compile` replaces process.env.NODE_ENV where the last step is written `.NODE_ENV`. A read that ends in ["NODE_ENV"] asks the environment of the run.
// Env: NODE_ENV=production
// Reference: bun build --compile
function production() {
  return "the arm for production";
}
function development() {
  return "the arm for development";
}

console.log(process.env["NODE_ENV"], process.env.NODE_ENV);
console.log(process.env[`NODE_ENV`], process["env"]["NODE_ENV"], process[`env`][`NODE_ENV`]);
console.log(process["env"].NODE_ENV, process[`env`].NODE_ENV);
console.log(process.env?.["NODE_ENV"], process.env?.NODE_ENV, process?.env.NODE_ENV);
console.log(globalThis.process.env["NODE_ENV"], globalThis.process.env.NODE_ENV);
console.log(import.meta.env["NODE_ENV"], Bun.env["NODE_ENV"], process.env["BUN_ENV"], process.env.BUN_ENV);
console.log(process.env["NODE_ENV"] === "production" ? production() : development());
console.log(process.env.NODE_ENV === "production" ? production() : development());
console.log(typeof process.env["NODE_ENV"], "NODE_ENV" in process.env, process.env["NODE_ENV"]?.length);

process.env["NODE_ENV"] = "stored";
console.log(process.env["NODE_ENV"], process.env.NODE_ENV);
delete process.env["NODE_ENV"];
console.log(process.env["NODE_ENV"], process.env.NODE_ENV);
