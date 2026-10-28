// Loops that count from one constant to another a few steps away, inside loops that run often: each prints what it adds up, what it leaves behind and what its closures hold.
function upBy(step) {
  let sum = 0;
  if (step === 1) for (let i = 0; i < 3; i++) sum += i * 10 + 1;
  if (step === 2) for (let i = 1; i <= 7; i += 2) sum += i;
  if (step === 3) for (let i = -4; i < 5; i += 3) sum += i * i;
  return sum;
}
function down() {
  let text = "";
  for (let i = 3; i > 0; i--) text += i;
  for (let i = 6; i >= 0; i -= 3) text += "," + i;
  for (let i = 2; i < 2; i++) text += "never";
  return text;
}
function leaves(turn) {
  let seen = "";
  for (var i = 0; i < 5; i++) {
    if (i === 1) continue;
    if (i === (turn & 7)) break;
    seen += i;
  }
  return seen + "|" + i;
}
function writesItsCounter(turn) {
  let turns = 0;
  for (let i = 0; i < 4; i++) {
    if (i === 1 && (turn & 1)) i += 2;
    turns++;
  }
  return turns;
}
function captures() {
  const made = [];
  for (let i = 0; i < 3; i++) made.push(() => i++ * 2);
  return made.map(f => f() + f()).join();
}
function throwsInside(turn) {
  let log = "";
  for (let i = 0; i < 3; i++) {
    try {
      if (i === (turn & 3)) throw new Error("at " + i);
      log += i;
    } catch (error) {
      log += "(" + error.message + ")";
    } finally {
      log += ";";
    }
  }
  return log;
}
function returnsInside(turn) {
  for (let i = 0; i < 4; i++) if (i * 2 === (turn & 7)) return "left at " + i;
  return "ran out";
}
function ofRest(...values) {
  let sum = 0;
  for (let k = 0; k < values.length; k++) sum += values[k];
  return sum;
}
function ofArguments() {
  let sum = "";
  for (let k = 0; k < arguments.length; k++) sum += arguments[k];
  return sum;
}
function joined(strings, ...values) {
  let text = "";
  for (let k = 0; k < values.length; k++) text += strings[k] + values[k];
  return text + strings[values.length] + strings.length + String(strings[strings.length]) + String(strings[-1]);
}
function raw(strings) {
  let text = "";
  for (let k = 0; k < strings.raw.length; k++) text += strings.raw[k] + "/" + String(strings[k]) + "|";
  return text;
}
const kept = new Set();
function keeps(strings) {
  kept.add(strings);
  return Object.isFrozen(strings) && Array.isArray(strings) && strings[0].length;
}
function storesTo(strings) {
  "use strict";
  try {
    strings[0] = "other";
  } catch (error) {
    return error.constructor.name + strings[0];
  }
  return "stored";
}
const lines = new Map();
for (let turn = 0; turn < 3000; turn++) {
  const line = [
    upBy(1), upBy(2), upBy(3), down(), leaves(turn), writesItsCounter(turn), captures(), throwsInside(turn), returnsInside(turn),
    ofRest(turn & 3, 2, 0.5), ofRest(), ofArguments("a", turn & 1, null), joined`a${turn & 3}bc${"x"}d`, joined`only`, raw`\n${1}\u{41}${2}\unicode`,
    keeps`a${turn}b`, storesTo`first${turn}`,
  ].join(" ");
  lines.set(line, (lines.get(line) ?? 0) + 1);
}
for (const [line, count] of lines) console.log(count, line);
console.log(kept.size);
