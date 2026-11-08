// `mock.module` lays what its factory returns over the exports of a module that has run, so the code of that module reads the new values out of its own
// variables, out of a `const` too. What it decides by them is decided when it runs: a branch, a `switch`, a loop, which file it requires.
// The function declaration at the top of each file keeps `bun run` from putting the values of the constants in place of their reads.
// leading-constants.mjs has none. There `bun run` prints the values of most constants in place of their reads, so those reads keep the old values behind the mock, as they did in executables before:
// `readAgain=word readFlag=true readMissing=undefined readNone=null readNumber=one readPiece=words readSum=three readWord=word`. An executable reads the variable there as it does everywhere.
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

// A constant in front of every other statement is a variable like any other: each read gets what the mock stored.
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
/* Output:
as written: Reader=off and=false chain=1 chosen=case one computedOnce=two conditional=off copy=one declared=off earlyReturn=one hoisted=one kind=number loaded=not loaded not=true notExported=one nullish=nothing object=table once=one or=fallback text=plain:5 turns=0 underAnotherName=one
mocked: Reader=on and=2 chain=undefined chosen=case two computedOnce=two conditional=on copy=one declared=on earlyReturn=other:2 hoisted=other:2 kind=number loaded=loaded not=false notExported=one nullish=0 object=no table once=other:2 or=true text=mocked:6 turns=3 underAnotherName=other:2
mocked where the names are handed on: Reader=on and=2 chain=1 chosen=case two computedOnce=two conditional=on copy=one declared=on earlyReturn=other:2 hoisted=one kind=number loaded=loaded not=false notExported=one nullish=nothing object=table once=one or=true text=plain:5 turns=3 underAnotherName=one
mocked behind a star: Reader=on and=2 chain=undefined chosen=case two computedOnce=two conditional=on copy=one declared=on earlyReturn=other:2 hoisted=other:2 kind=number loaded=loaded not=false notExported=one nullish=0 object=no table once=other:2 or=true text=mocked:6 turns=3 underAnotherName=other:2
leading constants mocked: readAgain=other:mocked readBig=other:2 readFlag=other:false readJoined=other:mocked readMissing=other:0 readNone=other:0 readNumber=other:2 readPiece=other:mocked readSum=other:4 readWide=other:mocked readWord=other:mocked
leading constants beside `export from` mocked: readNumber=other:2 readWord=other:mocked
*/
