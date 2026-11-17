// A loop leaves a generator that stands in an iteration over matches. What the loop's getter resumes goes on at the next match.
import { inspect } from "node:util";

const pick = name => (process.argv.length < 0 ? "" : name);
const inputs = ["a1b22c333d", "", "no digits", "9", "x7\u{1F600}8y\u{1F600}", "00 11 22 33 44"];
let log = [];
let how = 0;

const engines = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()));
const { next, return: finish, throw: raise } = engines;
function goOn() {
  for (let i = 0; i < 9; i++) {
    let r;
    try {
      r = i === how ? raise.call(this, new Error("t" + i)) : i === how - 9 ? finish.call(this, "r") : next.call(this, i);
    } catch (e) {
      log.push(e.message);
      break;
    }
    log.push(r.value, r.done);
    if (r.done) break;
  }
  return {};
}
function drive(name, run, prototype) {
  for (let turn = 0; turn < 60; turn++) {
    how = turn % 20;
    log = [];
    let r;
    try {
      r = run(inputs[turn % inputs.length], turn % 5);
    } catch (e) {
      r = e.message;
    }
    Object.setPrototypeOf(prototype, engines);
    if (turn < 12 || turn === 33 || turn === 59) console.log(name, turn, inspect(r), inspect(log, { depth: 3, breakLength: Infinity }));
  }
}
const heldPattern = /\d\d?/g;

function* literal(input) {
  for (const m of "a1b22c333d4444".matchAll(/\d+/g)) yield m[0];
  yield "end";
}
console.log([() => literal(inputs[0])].map(make => make().next().value));
const ownLiteral = { get value() { Object.setPrototypeOf(literal.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveLiteral(input, at) { for (const v of literal(input)) { if (at-- <= 0 && ownLiteral.value) return v; } return "none"; }
drive("literal", leaveLiteral, literal.prototype);

function* parts(input) {
  for (const m of "a1b2cc3".matchAll(/(\w)(\d)?/g)) yield [m[1], m[2], m.index];
  yield "end";
}
console.log([() => parts(inputs[0])].map(make => make().next().value));
const ownParts = { get value() { Object.setPrototypeOf(parts.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveParts(input, at) { for (const v of parts(input)) { if (at-- <= 0 && ownParts.value) return v; } return "none"; }
drive("parts", leaveParts, parts.prototype);

function* whole(input) {
  for (const m of "a1b2c3d4".matchAll(/[a-z](?<digit>\d)/g)) yield m;
  yield "end";
}
console.log([() => whole(inputs[0])].map(make => make().next().value));
const ownWhole = { get value() { Object.setPrototypeOf(whole.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveWhole(input, at) { for (const v of whole(input)) { if (at-- <= 0 && ownWhole.value) return v; } return "none"; }
drive("whole", leaveWhole, whole.prototype);

function* ofInput(input) {
  for (const m of input.matchAll(/(\w)(\d)?/g)) yield [m[1], m[2], m.index];
  yield "end";
}
console.log([() => ofInput(inputs[0])].map(make => make().next().value));
const ownOfInput = { get value() { Object.setPrototypeOf(ofInput.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveOfInput(input, at) { for (const v of ofInput(input)) { if (at-- <= 0 && ownOfInput.value) return v; } return "none"; }
drive("ofInput", leaveOfInput, ofInput.prototype);

function* ofText(input) {
  const text = `${input}z1`;
  let sum = 0;
  for (const m of text.matchAll(/\d/g)) {
    sum += +m[0];
    yield sum;
  }
  yield "end";
}
console.log([() => ofText(inputs[0])].map(make => make().next().value));
const ownOfText = { get value() { Object.setPrototypeOf(ofText.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveOfText(input, at) { for (const v of ofText(input)) { if (at-- <= 0 && ownOfText.value) return v; } return "none"; }
drive("ofText", leaveOfText, ofText.prototype);

function* unicode(input) {
  for (const m of `${input}\u{1F600}!\u{1F601}`.matchAll(/./gu)) yield m[0].length;
  yield "end";
}
console.log([() => unicode(inputs[0])].map(make => make().next().value));
const ownUnicode = { get value() { Object.setPrototypeOf(unicode.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveUnicode(input, at) { for (const v of unicode(input)) { if (at-- <= 0 && ownUnicode.value) return v; } return "none"; }
drive("unicode", leaveUnicode, unicode.prototype);

function* sets(input) {
  for (const m of `${input}\u{1F600}!`.matchAll(/[\p{ASCII}--[0-9]]/gv)) yield m[0] + m.index;
  yield "end";
}
console.log([() => sets(inputs[0])].map(make => make().next().value));
const ownSets = { get value() { Object.setPrototypeOf(sets.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveSets(input, at) { for (const v of sets(input)) { if (at-- <= 0 && ownSets.value) return v; } return "none"; }
drive("sets", leaveSets, sets.prototype);

function* held(input) {
  for (const m of `${input}55`.matchAll(heldPattern)) yield m[0] + ":" + m.index + ":" + heldPattern.lastIndex;
  yield "end";
}
console.log([() => held(inputs[0])].map(make => make().next().value));
const ownHeld = { get value() { Object.setPrototypeOf(held.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveHeld(input, at) { for (const v of held(input)) { if (at-- <= 0 && ownHeld.value) return v; } return "none"; }
drive("held", leaveHeld, held.prototype);

function* nested(input) {
  for (const word of `${input} q5 r66`.matchAll(/\S+/g)) {
    for (const digit of word[0].matchAll(/\d/g)) yield word[0] + digit[0];
    yield word.index;
  }
  yield "end";
}
console.log([() => nested(inputs[0])].map(make => make().next().value));
const ownNested = { get value() { Object.setPrototypeOf(nested.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveNested(input, at) { for (const v of nested(input)) { if (at-- <= 0 && ownNested.value) return v; } return "none"; }
drive("nested", leaveNested, nested.prototype);

function* underTry(input) {
  try {
    for (const m of `${input}s1t2u3`.matchAll(/[s-u]/g)) {
      try {
        yield m[0];
      } finally {
        log.push("f" + m.index);
      }
    }
  } catch (e) {
    log.push(e.message);
    yield "caught";
  }
  yield "end";
}
console.log([() => underTry(inputs[0])].map(make => make().next().value));
const ownUnderTry = { get value() { Object.setPrototypeOf(underTry.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveUnderTry(input, at) { for (const v of underTry(input)) { if (at-- <= 0 && ownUnderTry.value) return v; } return "none"; }
drive("underTry", leaveUnderTry, underTry.prototype);

function* delegated(input) {
  yield* `${input}k1l2`.matchAll(/[kl](\d)/g);
  yield "end";
}
console.log([() => delegated(inputs[0])].map(make => make().next().value));
const ownDelegated = { get value() { Object.setPrototypeOf(delegated.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveDelegated(input, at) { for (const v of delegated(input)) { if (at-- <= 0 && ownDelegated.value) return v; } return "none"; }
drive("delegated", leaveDelegated, delegated.prototype);

function* overTexts(input) {
  for (const text of inputs) for (const m of text.matchAll(/\d/g)) yield text.length + m[0];
  yield "end";
}
console.log([() => overTexts(inputs[0])].map(make => make().next().value));
const ownOverTexts = { get value() { Object.setPrototypeOf(overTexts.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveOverTexts(input, at) { for (const v of overTexts(input)) { if (at-- <= 0 && ownOverTexts.value) return v; } return "none"; }
drive("overTexts", leaveOverTexts, overTexts.prototype);

function* counted(input) {
  let last = 0;
  for (const m of "p1q2r3s4".matchAll(/[a-z]/g)) last = yield m[0] + last;
  yield "end";
}
console.log([() => counted(inputs[0])].map(make => make().next().value));
const ownCounted = { get value() { Object.setPrototypeOf(counted.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveCounted(input, at) { for (const v of counted(input)) { if (at-- <= 0 && ownCounted.value) return v; } return "none"; }
drive("counted", leaveCounted, counted.prototype);

function* emptyMatches(input) {
  for (const m of `${input}b`.matchAll(/a*/g)) yield m.index;
  yield "end";
}
console.log([() => emptyMatches(inputs[0])].map(make => make().next().value));
const ownEmptyMatches = { get value() { Object.setPrototypeOf(emptyMatches.prototype, { __proto__: engines, [pick("return")]: goOn }); return 1; } };
function leaveEmptyMatches(input, at) { for (const v of emptyMatches(input)) { if (at-- <= 0 && ownEmptyMatches.value) return v; } return "none"; }
drive("emptyMatches", leaveEmptyMatches, emptyMatches.prototype);
