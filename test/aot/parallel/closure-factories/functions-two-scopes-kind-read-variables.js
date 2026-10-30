// Every call of make() has variables of its own. A function of one call that is handed a function of another call reads its own variables and lets the other read the other's.
function show(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error.name);
  }
}

function make(name, given) {
  function length() {
    return text.length;
  }
  function first(at) {
    return text.charCodeAt(at);
  }
  function walk(turns, other) {
    let sum = 0;
    let at = 0;
    while (at < turns) {
      sum += first(at % length());
      if (other) sum += other();
      at++;
    }
    return sum + ":" + text;
  }
  function walkNothing(other) {
    let sum = 0;
    for (let at = 0; at < count; at++) sum += other() + length();
    return sum + text.length;
  }
  if (given) show(name + " early", given);
  show(name + " own early", length);
  show(name + " walk early", () => walk(0));
  let text = name;
  let count = name.length & 1;
  return { length, first, walk, walkNothing };
}

const one = make("abc");
const two = make("defghi", one.length);
const three = make("jk", () => two.walk(2, one.length));
for (let round = 0; round < 3; round++) {
  show("one", () => one.walk(4 + round, two.length));
  show("two", () => two.walk(3 + round, three.length));
  show("three", () => three.walk(round, one.length));
  show("nothing", () => one.walkNothing(two.length) + two.walkNothing(three.length) + three.walkNothing(one.length));
}

// The name of a declared function may get another function: one of another call.
function makeWithSwap(name, swapped) {
  function length() {
    return text.length;
  }
  function walk(turns) {
    let sum = 0;
    for (let at = 0; at < turns; at++) sum += length();
    return sum + ":" + text.length;
  }
  let text = name;
  if (swapped) length = swapped;
  return { length, walk, own: () => text };
}
const plain = makeWithSwap("four");
const swapped = makeWithSwap("sixsix", plain.length);
for (let round = 0; round < 3; round++) console.log(plain.walk(3), swapped.walk(3), swapped.own());

// A function that is entered while the variables of its own call are not stored yet, by way of a function of an earlier call.
let hook;
function makeWithHook(name) {
  function length() {
    return text.length;
  }
  function walk(turns) {
    let sum = 0;
    for (let at = 0; at < turns; at++) sum += length();
    return sum + text.length;
  }
  if (hook) show(name + " hook", () => hook(walk));
  let text = name;
  hook = run => run(2) + walk(1);
  return walk;
}
const walks = [makeWithHook("a"), makeWithHook("bcd"), makeWithHook("ef")];
for (const walk of walks) show("walk", () => walk(3));

// Nothing runs early here: every variable is stored before a function of its call can be entered.
function makeClean(name) {
  let text = name;
  let count = name.length;
  function length() {
    return text.length;
  }
  function first(at) {
    return text.charCodeAt(at);
  }
  function walk(turns, other) {
    let sum = 0;
    let at = 0;
    while (at < turns) {
      sum += first(at % length()) + other();
      at++;
    }
    return sum + ":" + text + ":" + count;
  }
  function grow(by) {
    text += by;
    count++;
    return walk(count, length);
  }
  return { length, first, walk, grow };
}
const cleans = [makeClean("ab"), makeClean("cdefg"), makeClean("hij")];
for (let round = 0; round < 4; round++) {
  for (let index = 0; index < cleans.length; index++) {
    const next = cleans[(index + 1) % cleans.length];
    console.log(
      cleans[index].walk(round + index, next.length),
      cleans[index].walk(0, next.length),
      next.grow(String(round)),
    );
  }
}
