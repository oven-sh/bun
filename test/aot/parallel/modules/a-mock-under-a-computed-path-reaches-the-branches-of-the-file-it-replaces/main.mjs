// The build cannot tell which file `mock.module` replaces the exports of, so the code of every file reads its exported variables when it runs, and decides by
// what it finds there. See a-mock-reaches-the-branches-of-the-file-whose-exports-it-replaces.
// Alone: every file of the executable is one that the mock may replace, so the programs beside it would be compiled otherwise than they are alone
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

const path = ["./fl", "ags.mjs"];
const held = { ...(await import("./flags.mjs")) };
console.log("as written:", state(held));
mock.module(path.join(""), replacement);
console.log("mocked:", state(held));
