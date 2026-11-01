// A `typeof` test is repeated behind a join, behind both arms of another test, and round a loop. Values of every kind come in through `any`, so the written types say nothing true.
// Flags: --aot-validate
interface Holder {
  inner: number;
}
const said: string[] = [];
function say(where: string, value: unknown) {
  said.push(where + ":" + (typeof value === "symbol" ? "symbol" : typeof value === "function" ? "function" : JSON.stringify(value) ?? String(value)));
}

function behindJoin(value: Holder | boolean) {
  if (typeof value === "function") say("first function", value);
  else say("first other", value);
  if (typeof value === "function") say("second function", (() => value)());
  else say("second other", (() => value)());
}

function behindBothArms(value: Holder | boolean, flag: boolean) {
  if (typeof value !== "function") return;
  if (flag) say("flag", 1);
  else say("no flag", 0);
  if (typeof value !== "function") say("never", (() => value)());
  else say("still function", (() => value)());
}

function roundLoop(value: Holder | boolean | string, turns: number) {
  let current: unknown = value;
  for (let turn = 0; turn < turns; turn++) {
    if (typeof current === "string") {
      say("string in turn " + turn, (() => current)());
      continue;
    }
    say("other in turn " + turn, (() => current)());
    current = turn === 0 ? "text" : current;
  }
}

function objectTwice(value: Holder | boolean) {
  if (typeof value === "object") {
    say("object", value);
    return;
  }
  if (typeof value == "object") say("never", (() => value)());
  else say("no object", (() => value)());
}

const given: any[] = [
  JSON.parse("{}"),
  JSON.parse("[1]"),
  JSON.parse("null"),
  true,
  undefined,
  0,
  -0,
  "text",
  10n.toString(),
  Symbol.iterator,
  function named() {},
  () => 1,
  class {},
  Math.max,
  new Proxy(function () {}, {}),
  new Proxy({}, {}),
  new Date(0),
  { inner: 2 },
];
for (let round = 0; round < 3; round++) {
  for (const value of given) {
    behindJoin(value);
    behindBothArms(value, round === 1);
    roundLoop(value, 3);
    objectTwice(value);
  }
}
console.log(said.length);
console.log(said.slice(0, said.length / 3).join("\n"));
