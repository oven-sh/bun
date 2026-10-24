// `Object.keys` answers an array whose storage it shares with later answers for the same shape, until somebody writes to it. Code that does not know it
// holds an array reads `length` by name many times, then each way of writing (a push, an element, a shorter and a longer length) changes that one array only.
const box = JSON.parse("[0]");
function hidden(value) { box[0] = value; return box[0]; }
const rounds = JSON.parse("70");

function lengthOf(list) { return list.length; }
function setLength(list, length) { list.length = length; }
function count(list) { let n = 0; for (const item of list) n += item.length; return n; }

function repeated(access) {
  const answer = access();
  for (let i = 1; i < rounds; i++) {
    const next = access();
    if (next !== answer) return answer + " then " + next + " at " + i;
  }
  return String(answer);
}

const shape = () => ({ alpha: 1, beta: 2, gamma: 3, delta: 4 });
const fresh = () => hidden(Object.keys(shape()));

const first = fresh();
console.log("read", repeated(() => lengthOf(first)), repeated(() => count(first)));

const writers = {
  push(list) { list.push("epsilon"); },
  element(list) { list[6] = "eta"; },
  shorter(list) { setLength(list, 2); },
  longer(list) { setLength(list, 9); },
  same(list) { setLength(list, 4); },
  zero(list) { setLength(list, 0); },
};
for (const [name, write] of Object.entries(writers)) {
  for (let round = 0; round < rounds; round++) {
    const list = fresh();
    const before = lengthOf(list);
    write(list);
    const other = fresh();
    const line = [before, lengthOf(list), list.join("|"), lengthOf(other), other.join("|"), lengthOf(first)].join(" ");
    if (round === 0 || round === rounds - 1) console.log(name, round, line);
  }
}

const frozen = Object.freeze(fresh());
console.log("frozen", repeated(() => lengthOf(frozen)), (() => { "use strict"; try { setLength(frozen, 1); return "stored"; } catch (error) { return error.constructor.name; } })(), lengthOf(frozen));
console.log("still", lengthOf(first), first.join("|"), Object.keys(shape()).length);
