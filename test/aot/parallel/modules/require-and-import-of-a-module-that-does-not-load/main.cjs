// Which error require() and import() get of a module whose import statement names nothing, and after how many jobs.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
globalThis.ran = [];
const errors = [];
const which = error => {
  if (!errors.includes(error)) errors.push(error);
  return `${error?.constructor?.name} ${error?.code} ${error?.specifier}, error ${errors.indexOf(error)}`;
};
function jobsUntilSettled(start) {
  return new Promise(done => {
    let jobs = 0;
    let isSettled = false;
    const count = () => {
      if (isSettled) return;
      if (++jobs === 80) return done("not settled within 80 jobs");
      Promise.resolve().then(count);
    };
    const say = how => value => {
      isSettled = true;
      done(`${how} after ${jobs} jobs${how === "rejected" ? " with " + which(value) : ""}`);
    };
    start().then(say("fulfilled"), say("rejected"));
    Promise.resolve().then(count);
  });
}
const required = load => {
  try {
    load();
    return "returned";
  } catch (error) {
    return "threw " + which(error);
  }
};
(async () => {
  console.log("imported-first: import low:", await jobsUntilSettled(() => import("./imported-first/low.mjs")));
  console.log("imported-first: require low:", required(() => require("./imported-first/low.mjs")));
  console.log("imported-first: import low:", await jobsUntilSettled(() => import("./imported-first/low.mjs")));
  console.log("imported-first: require high:", required(() => require("./imported-first/high.mjs")));
  console.log("imported-first: import high:", await jobsUntilSettled(() => import("./imported-first/high.mjs")));

  console.log("required-first: require low:", required(() => require("./required-first/low.mjs")));
  console.log("required-first: require low:", required(() => require("./required-first/low.mjs")));
  console.log("required-first: import low:", await jobsUntilSettled(() => import("./required-first/low.mjs")));
  console.log("required-first: import high:", await jobsUntilSettled(() => import("./required-first/high.mjs")));

  console.log("from-above: require high:", required(() => require("./from-above/high.mjs")));
  console.log("from-above: import high:", await jobsUntilSettled(() => import("./from-above/high.mjs")));
  console.log("from-above: import low:", await jobsUntilSettled(() => import("./from-above/low.mjs")));

  const inFlight = jobsUntilSettled(() => import("./while-imported/high.mjs"));
  console.log("while-imported: require high:", required(() => require("./while-imported/high.mjs")));
  console.log("while-imported: import high:", await inFlight);

  const lowInFlight = jobsUntilSettled(() => import("./below-an-import/high.mjs"));
  await null;
  await null;
  await null;
  await null;
  await null;
  console.log("below-an-import: require low, five jobs in:", required(() => require("./below-an-import/low.mjs")));
  console.log("below-an-import: import high:", await lowInFlight);
  console.log("ran:", globalThis.ran.join(" ") || "nothing");
})();
