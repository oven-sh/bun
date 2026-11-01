// `mock.module` lays what its factory returns over the exports of a module that has run, so the code of that module reads the new values out of its own
// variables, out of a `const` too. What it decides by them is decided when it runs: a branch, a `switch`, a loop, which file it requires.
// The function declaration at the top of each file keeps `bun run` from putting the values of the constants in place of their reads.
import { mock } from "bun:test";

const show = value => (typeof value === "function" ? "function" : String(value));
function state(held) {
  const answers = [];
  for (const name of Object.keys(held).sort()) {
    if (typeof held[name] !== "function" || name === "first") continue;
    answers.push(name + "=" + show(name === "Reader" ? new held.Reader().read() : held[name]()));
  }
  return answers.join(" ");
}
const replacement = () => ({
  enabled: true,
  level: 2,
  label: "mocked",
  nothing: 0,
  table: null,
  storedOnce: 2,
  declaredWithVar: 2,
  renamed: 2,
  default: 2,
});

const whole = { ...(await import("./flags.mjs")) };
console.log("as written:", state(whole));
mock.module("./flags.mjs", replacement);
console.log("mocked:", state(whole));

const handedOn = { ...(await import("./handed-on.mjs")) };
await import("./hands-on.mjs");
mock.module("./hands-on.mjs", () => ({ enabled: true, depth: 2 }));
console.log("mocked where the names are handed on:", state(handedOn));

const behindAStar = { ...(await import("./behind-a-star.mjs")) };
await import("./star.mjs");
mock.module("./star.mjs", replacement);
console.log("mocked behind a star:", state(behindAStar));

// `bun run` puts the values of some leading constants in place of their reads, and those reads keep them.
const leadingReplacement = () => ({
  number: 2,
  word: "mocked",
  none: 0,
  missing: 0,
  sum: 4,
  flag: false,
  again: "mocked",
  piece: "mocked",
  big: 2n,
  joined: "mocked",
  wide: "mocked",
});
const leading = { ...(await import("./leading-constants.mjs")) };
mock.module("./leading-constants.mjs", leadingReplacement);
console.log("leading constants mocked:", state(leading));

const besideExportFrom = { ...(await import("./leading-constants-beside-export-from.mjs")) };
mock.module("./leading-constants-beside-export-from.mjs", leadingReplacement);
console.log("leading constants beside `export from` mocked:", state(besideExportFrom));
