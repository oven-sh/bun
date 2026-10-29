// An import of an evaluated module settles in the same job however the module was first loaded.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import { b } from "./static.mjs";
const lines = [];
async function race(label, start) {
  const seen = [];
  const settled = start().then(
    namespace => seen.push(`<${label}: ${Object.keys(namespace).join(" ")}>`),
    error => seen.push(`<${label} rejected: ${error}>`),
  );
  let turns = Promise.resolve();
  for (let turn = 1; turn <= 16; turn++) turns = turns.then(() => seen.push(String(turn)));
  await turns;
  await settled;
  lines.push(seen.join(" "));
}
await import("./first.mjs");
await race("imported before", () => import("./first.mjs"));
await race("imported by the entry point", () => import("./static.mjs"));
const required = require("./required.mjs");
await race("required before", () => import("./required.mjs"));
await race("below a module imported before", () => import("./below.mjs"));
await race("waits", () => import("./waits.mjs"));
await race("waited before", () => import("./waits.mjs"));
await import("./then.mjs").then(value => lines.push(`then() gave ${value}`));
await race("exports then()", () => import("./then.mjs").then(value => ({ [value]: 1 })));
{
  const seen = [];
  globalThis.note = text => seen.push(text);
  const all = [
    import("./first.mjs").then(() => seen.push("first")),
    import("./fresh.mjs").then(() => seen.push("fresh")),
    import("./static.mjs").then(() => seen.push("static")),
    Promise.resolve().then(() => seen.push("job")),
  ];
  let turns = Promise.resolve();
  for (let turn = 1; turn <= 30; turn++) turns = turns.then(() => seen.push(String(turn)));
  await Promise.all(all);
  await turns;
  lines.push(seen.join(" "));
}
{
  const seen = [];
  const settled = import("./first.mjs").then(() => seen.push("first"));
  seen.push(`required ${require("./over-first.mjs").over}`);
  let turns = Promise.resolve();
  for (let turn = 1; turn <= 12; turn++) turns = turns.then(() => seen.push(String(turn)));
  await settled;
  await turns;
  lines.push(seen.join(" "));
}
console.log(lines.join("\n"));
console.log(b, required.c);
