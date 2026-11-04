// `x || "a"` is true and `x && ""` is false whatever `x` is, and `bun run` removes what that rules out. What the whole IS it knows only where it knows whether `x` is true.
// The files whose names start with "left" hold the tests that it leaves as they are written: they are CommonJS.
const files = [
  ["or-a-text", () => import("./or-a-text.js")],
  ["and-an-empty-text", () => import("./and-an-empty-text.js")],
  ["unknown-or-a-text", () => import("./unknown-or-a-text.js")],
  ["unknown-and-an-empty-text", () => import("./unknown-and-an-empty-text.js")],
  ["or-then-and", () => import("./or-then-and.js")],
  ["or-then-or", () => import("./or-then-or.js")],
  ["and-then-or", () => import("./and-then-or.js")],
  ["and-then-and", () => import("./and-then-and.js")],
  ["not-or", () => import("./not-or.js")],
  ["not-and", () => import("./not-and.js")],
  ["or-in-front-of-or", () => import("./or-in-front-of-or.js")],
  ["and-in-front-of-and", () => import("./and-in-front-of-and.js")],
  ["or-as-the-test-of-a-conditional", () => import("./or-as-the-test-of-a-conditional.js")],
  ["unknown-or-in-front-of-or", () => import("./unknown-or-in-front-of-or.js")],
  ["unknown-and-in-front-of-and", () => import("./unknown-and-in-front-of-and.js")],
  ["or-behind-a-comma", () => import("./or-behind-a-comma.js")],
  ["or-out-of-a-list", () => import("./or-out-of-a-list.js")],
  ["template-and-zero", () => import("./template-and-zero.js")],
  ["zero-or-a-text-compared", () => import("./zero-or-a-text-compared.js")],
  ["one-and-a-text-compared", () => import("./one-and-a-text-compared.js")],
  ["left-and-a-text", () => import("./left-and-a-text.js")],
  ["left-or-an-empty-text", () => import("./left-or-an-empty-text.js")],
  ["left-unknown-and-a-text", () => import("./left-unknown-and-a-text.js")],
  ["left-compared", () => import("./left-compared.js")],
  ["left-type-of", () => import("./left-type-of.js")],
  ["left-joined", () => import("./left-joined.js")],
  ["left-length", () => import("./left-length.js")],
  ["left-in-a-constant", () => import("./left-in-a-constant.js")],
  ["left-in-front-of-nullish", () => import("./left-in-front-of-nullish.js")],
  ["left-in-a-template", () => import("./left-in-a-template.js")],
  ["left-template-or-zero", () => import("./left-template-or-zero.js")],
  ["left-zero-or-a-template", () => import("./left-zero-or-a-template.js")],
  ["left-one-and-a-template", () => import("./left-one-and-a-template.js")],
];
for (const [name, load] of files) {
  const namespace = await load();
  console.log(name, globalThis.mode, Object.keys(namespace).join("+") || "none");
}
