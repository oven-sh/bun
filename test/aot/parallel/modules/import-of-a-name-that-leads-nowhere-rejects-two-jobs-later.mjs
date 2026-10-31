// The loader rejects a promise of its own for a name that it does not find, and the promise that import() gives the program follows it two jobs later.
function jobsUntilSettled(start) {
  return new Promise(done => {
    let jobs = 0;
    let isSettled = false;
    const count = () => {
      if (isSettled) return;
      if (++jobs === 50) return done("not settled within 50 jobs");
      Promise.resolve().then(count);
    };
    const say = how => value => {
      isSettled = true;
      done(`${how} with ${value?.constructor?.name} ${value?.code} after ${jobs} jobs`);
    };
    start().then(say("fulfilled"), say("rejected"));
    Promise.resolve().then(count);
  });
}
const path = name => "./" + name + ".mjs";
const packageName = name => name + "-that-nobody-installed";

console.log("a path:", await jobsUntilSettled(() => import("./a-file-that-is-not-there.mjs")));
console.log("the same path again:", await jobsUntilSettled(() => import("./a-file-that-is-not-there.mjs")));
console.log("a computed path:", await jobsUntilSettled(() => import(path("another-file-that-is-not-there"))));
console.log("a package:", await jobsUntilSettled(() => import("a-package-that-nobody-installed")));
console.log("a computed package:", await jobsUntilSettled(() => import(packageName("some-package"))));
console.log("a built-in module:", await jobsUntilSettled(() => import("node:a-module-that-is-not-there")));
console.log("a path with a type:", await jobsUntilSettled(() => import("./a-file-that-is-not-there.json", { with: { type: "json" } })));
console.log("a computed path with a type:", await jobsUntilSettled(() => import(path("a-file-that-is-not-there") + ".json", { with: { type: "json" } })));
console.log(
  "awaited in an async function:",
  await jobsUntilSettled(async () => {
    await import("./a-file-that-is-not-there.mjs");
  }),
);

console.log(
  "a name whose toString throws:",
  await jobsUntilSettled(() =>
    import({
      toString() {
        throw new RangeError("no name");
      },
    }),
  ),
);
console.log(
  "options whose getter throws:",
  await jobsUntilSettled(() =>
    import("./a-file-that-is-not-there.mjs", {
      get with() {
        throw new RangeError("no options");
      },
    }),
  ),
);
console.log("options that are no object:", await jobsUntilSettled(() => import("./a-file-that-is-not-there.mjs", 1)));

const order = [];
import("./a-file-that-is-not-there.mjs").catch(() => order.push("the import"));
Promise.reject(new Error("rejected at once")).catch(() => order.push("a rejected promise"));
await Promise.resolve()
  .then(() => order.push("job 1"))
  .then(() => order.push("job 2"))
  .then(() => order.push("job 3"))
  .then(() => order.push("job 4"));
console.log(order.join(", "));
