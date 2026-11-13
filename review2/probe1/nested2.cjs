// Listener spins the event loop synchronously via require() of a module whose plugin onLoad is async.
const { spawn } = require("node:child_process");
Bun.plugin({
  name: "slow",
  setup(build) {
    build.onResolve({ filter: /^slow:/ }, args => ({ path: args.path.slice(5), namespace: "slow" }));
    build.onLoad({ filter: /.*/, namespace: "slow" }, async () => {
      await new Promise(r => setTimeout(r, 400));
      return { contents: "module.exports = 1;", loader: "js" };
    });
  },
});
const child = spawn("sh", ["-c", "printf 1; sleep 0.1; printf 2; sleep 0.1; printf 3"], { stdio: ["ignore", "pipe", "inherit"] });
const order = [];
let n = 0;
child.stdout.on("data", d => {
  const k = ++n;
  order.push("in" + k + "=" + d);
  if (k === 1) { try { require("slow:x"); } catch (e) { order.push("require-threw:" + (e.code || e.message)); } }
  order.push("out" + k);
});
child.stdout.on("end", () => order.push("end"));
child.on("exit", code => order.push("exit"));
child.on("close", code => console.log(order.join(" ") + " close=" + code));
