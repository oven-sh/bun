// `require(flag ? "node:vm" : "node:v8")`: what stands in the parentheses is no plain string, yet each arm is a constant name, and a bundler treats it as two calls. Both modules are in, whichever way the flag falls where the program runs. The output is that of plain Bun.
// Env: FLAGS=1,0
for (const flag of process.env.FLAGS.split(",").map(text => text === "1")) {
  const ways = {
    require: () => require(flag ? "node:vm" : "node:v8"),
    import: () => import(flag ? "node:dgram" : "node:zlib"),
    getBuiltinModule: () => process.getBuiltinModule(flag ? "node:assert" : "node:perf_hooks"),
    "import.meta.require": () => import.meta.require(flag ? "node:http2" : "node:https"),
    nested: () => require(flag ? "node:worker_threads" : flag === false ? "node:readline" : "node:repl"),
  };
  for (const way in ways) {
    try {
      console.log(flag, way, typeof (await ways[way]()));
    } catch (error) {
      console.log(flag, way, error.code);
    }
  }
}
