// Calls with several possible callees: some ignore `this` or extra arguments, some reach them through `this`, `arguments` or a rest parameter.
const kept = [];
function ignoresAll(a) { return a; }
function usesThis(a) { kept.push(this); return a; }
function usesArguments(a) { kept.push(arguments[1]); return a; }
function usesRest(a, ...rest) { kept.push(rest[0]); return a; }
function countsArguments(a) { return arguments.length + a; }
const arrow = a => a + 1;
const callees = [ignoresAll, usesThis, usesArguments, usesRest, countsArguments, arrow];

function callAll(index) {
  const receiver = { tag: "receiver" + index, f: callees[index % callees.length] };
  const extra = { tag: "extra" + index };
  const result = receiver.f(index, extra);
  receiver.tag += "!";
  extra.tag += "?";
  return result;
}

function makePair(first) {
  return first
    ? { value: 1, get() { return 10; } }
    : { value: 2, get() { return this.value; } };
}

function readPair(first) {
  const pair = makePair(first);
  pair.value += 5;
  return pair.get();
}

let total = 0;
for (let i = 0; i < 1200; i++) total += callAll(i) + readPair(i % 2 === 0);
console.log(total, kept.length, kept.slice(-6).map(item => item.tag).join(","));
