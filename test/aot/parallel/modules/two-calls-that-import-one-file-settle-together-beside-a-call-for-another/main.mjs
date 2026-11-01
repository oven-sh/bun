// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// Two import() calls for one file, and a call for another file between them. An executable holds every text: the three settle in the order of the calls, so the two never settle next to each other.
// The name says what `bun run` does.
const groups = [
  [() => import("./twice-1.mjs"), () => import("./other-1.mjs"), () => import("./twice-1.mjs")],
  [() => import("./b/twice-1.mjs"), () => import("./b/other-1.mjs"), () => import("./b/twice-1.mjs")],
  [() => import("./c/twice-1.mjs"), () => import("./c/other-1.mjs"), () => import("./c/twice-1.mjs")],
  [() => import("./d/twice-1.mjs"), () => import("./d/other-1.mjs"), () => import("./d/twice-1.mjs")],
  [() => import("./e/twice-1.mjs"), () => import("./e/other-1.mjs"), () => import("./e/twice-1.mjs")],
  [() => import("./f/twice-1.mjs"), () => import("./f/other-1.mjs"), () => import("./f/twice-1.mjs")],
  [() => import("./g/twice-1.mjs"), () => import("./g/other-1.mjs"), () => import("./g/twice-1.mjs")],
  [() => import("./h/twice-1.mjs"), () => import("./h/other-1.mjs"), () => import("./h/twice-1.mjs")],
];
let together = 0;
async function run() {
  for (const [first, other, second] of groups) {
    const settled = [];
    const note = name => () => settled.push(name);
    await Promise.all([first().then(note("twice")), other().then(note("other")), second().then(note("twice"))]);
    if (settled.join(" ").includes("twice twice")) together++;
  }
  console.log(together >= groups.length - 2, globalThis.ran);
}
run();
