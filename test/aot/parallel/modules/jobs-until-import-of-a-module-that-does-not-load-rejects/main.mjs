// How many jobs of the program run before import() of a module rejects whose import statements lead to a name that nothing answers to.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
globalThis.ran = [];
const errors = [];
function jobsUntilSettled(starts) {
  return new Promise(done => {
    let jobs = 0;
    let left = starts.length;
    const said = [];
    const count = () => {
      if (!left) return;
      if (++jobs === 80) return done(said.concat("not settled within 80 jobs"));
      Promise.resolve().then(count);
    };
    starts.forEach((start, index) => {
      const say = how => value => {
        said[index] = `${how} after ${jobs} jobs`;
        if (how === "rejected") {
          if (!errors.includes(value)) errors.push(value);
          said[index] += ` with ${value?.constructor?.name} ${value?.code} ${value?.specifier}, error ${errors.indexOf(value)}`;
        }
        if (!--left) done(said);
      };
      start().then(say("fulfilled"), say("rejected"));
    });
    Promise.resolve().then(count);
  });
}
async function say(label, ...starts) {
  const said = await jobsUntilSettled(starts);
  console.log(`${label}: ${said.join(" | ")}; ran: ${globalThis.ran.splice(0).join(" ") || "nothing"}`);
}

await say("own-statement: root.mjs", () => import("./own-statement/root.mjs"));
await say("own-statement: root.mjs", () => import("./own-statement/root.mjs"));
await say("one-level-down: root.mjs", () => import("./one-level-down/root.mjs"));
await say("one-level-down: root.mjs", () => import("./one-level-down/root.mjs"));
await say("one-level-down: a.mjs", () => import("./one-level-down/a.mjs"));
await say("two-levels-down: root.mjs", () => import("./two-levels-down/root.mjs"));
await say("two-levels-down: a.mjs", () => import("./two-levels-down/a.mjs"));
await say("two-levels-down: b.mjs", () => import("./two-levels-down/b.mjs"));
await say("four-levels-down: root.mjs", () => import("./four-levels-down/root.mjs"));
await say("a-package: root.mjs", () => import("./a-package/root.mjs"));
await say("exported-again: root.mjs", () => import("./exported-again/root.mjs"));
await say("a-name: root.mjs", () => import("./a-name/root.mjs"));
await say("awaits-at-top-level: root.mjs", () => import("./awaits-at-top-level/root.mjs"));
await say("behind-a-module-that-loads: root.mjs", () => import("./behind-a-module-that-loads/root.mjs"));
await say("in-front-of-a-module-that-loads: root.mjs", () => import("./in-front-of-a-module-that-loads/root.mjs"));
await say("below-a-module-that-loads-another: root.mjs", () => import("./below-a-module-that-loads-another/root.mjs"));
await say("behind-a-module-that-has-run: loads.mjs", () => import("./behind-a-module-that-has-run/loads.mjs"));
await say("behind-a-module-that-has-run: root.mjs", () => import("./behind-a-module-that-has-run/root.mjs"));
await say("two-statements: root.mjs", () => import("./two-statements/root.mjs"));
await say("the-nearer-of-two: root.mjs", () => import("./the-nearer-of-two/root.mjs"));
await say("the-first-of-two: root.mjs", () => import("./the-first-of-two/root.mjs"));
await say(
  "two-at-once: one.mjs and other.mjs",
  () => import("./two-at-once/one.mjs"),
  () => import("./two-at-once/other.mjs"),
);
await say(
  "beside-an-import-that-loads: root.mjs and loads.mjs",
  () => import("./beside-an-import-that-loads/root.mjs"),
  () => import("./beside-an-import-that-loads/loads.mjs"),
);
await say(
  "behind-an-import-that-loads: loads.mjs and root.mjs",
  () => import("./behind-an-import-that-loads/loads.mjs"),
  () => import("./behind-an-import-that-loads/root.mjs"),
);
await say(
  "the-same-twice-at-once: root.mjs and root.mjs",
  () => import("./the-same-twice-at-once/root.mjs"),
  () => import("./the-same-twice-at-once/root.mjs"),
);
await say(
  "two-depths-at-once: deep.mjs and shallow.mjs",
  () => import("./two-depths-at-once/deep.mjs"),
  () => import("./two-depths-at-once/shallow.mjs"),
);
await say("above-one-that-has-failed: low.mjs", () => import("./above-one-that-has-failed/low.mjs"));
await say("above-one-that-has-failed: high.mjs", () => import("./above-one-that-has-failed/high.mjs"));
await say("above-one-that-has-failed: high.mjs", () => import("./above-one-that-has-failed/high.mjs"));
await say("two-roots-over-one: one.mjs", () => import("./two-roots-over-one/one.mjs"));
await say("two-roots-over-one: other.mjs", () => import("./two-roots-over-one/other.mjs"));
await say("in-a-cycle: root.mjs", () => import("./in-a-cycle/root.mjs"));
await say("in-a-cycle: a.mjs", () => import("./in-a-cycle/a.mjs"));

setTimeout(async () => {
  await say("behind-the-entry-point: root.mjs", () => import("./behind-the-entry-point/root.mjs"));
  await say("behind-the-entry-point: deep.mjs", () => import("./behind-the-entry-point/deep.mjs"));
}, 1);
