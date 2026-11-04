// Code that the build has not seen writes the variables that a direct eval sees, the properties of the program's functions, and what lists, maps and sets of the program hold.
function counter() {
  let count = 1;
  let label = "one";
  const evaluate = text => eval(text);
  const read = () => count + label.length;
  return { evaluate, read, bump: () => ++count };
}

function attempt(act) {
  try {
    const value = act();
    return typeof value === "string" ? JSON.stringify(value) : String(value);
  } catch (error) {
    return error.name;
  }
}

const first = counter();
for (let turn = 0; turn < 50; turn++) first.read();
console.log(first.read(), first.bump());
first.evaluate("count = 'text'");
console.log(attempt(first.read), attempt(first.bump));
first.evaluate("label = 5; count = { valueOf() { return 40; } }");
console.log(attempt(first.read), attempt(first.bump), attempt(first.read));
first.evaluate("label = null");
console.log(attempt(first.read));
first.evaluate("var added = 3; count = added; label = 'back'");
console.log(attempt(first.read), attempt(() => first.evaluate("added + count")));

function plain(a, b) {
  return a + b;
}
function callsPlain(turns, deed) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn === 5) deed(plain);
    sum += plain(turn, 1) + plain.length + (plain.extra ?? 0) + plain.name.length;
  }
  return sum;
}
const unseen = text => (0, eval)(text);
console.log(callsPlain(8, () => {}));
console.log(attempt(() => callsPlain(8, unseen("f => { f.extra = 100; }"))));
console.log(attempt(() => callsPlain(8, unseen("f => { Object.defineProperty(f, 'length', { value: 50 }); }"))));
console.log(attempt(() => callsPlain(8, unseen("f => { Object.defineProperty(f, 'name', { value: 'a longer name' }); }"))));
console.log(attempt(() => callsPlain(8, unseen("f => { delete f.extra; Object.freeze(f); }"))));
console.log(attempt(() => callsPlain(8, unseen("f => { Object.setPrototypeOf(f, { extra: 7 }); }"))), attempt(() => plain.call(null, 1, 2)));
console.log(attempt(() => new plain(1, 2) instanceof plain), attempt(() => unseen("f => { f.prototype = { marked: true }; return new f(1, 2).marked; }")(function made() {})));

function sumOfList(list, deed) {
  let sum = 0;
  for (let index = 0; index < list.length; index++) {
    if (index === 2) deed(list);
    sum += list[index];
  }
  return sum;
}
const listOf = () => [1, 2, 3, 4, 5];
for (let turn = 0; turn < 50; turn++) sumOfList(listOf(), () => {});
for (const text of [
  "l => { l[3] = 'text'; }",
  "l => { l[3] = 1.5; }",
  "l => { l[3] = { valueOf() { return 9; } }; }",
  "l => { delete l[3]; }",
  "l => { l.length = 3; }",
  "l => { l.push('more'); }",
  "l => { l[10] = 1; }",
  "l => { Object.defineProperty(l, 3, { get() { return 1000; } }); }",
  "l => { Object.freeze(l); }",
  "l => { Object.setPrototypeOf(l, { 3: 'above', length: 9 }); delete l[3]; }",
  "l => { l.fill(null); }",
  "l => { l.reverse(); }",
  "l => { l.splice(0, 2); }",
]) {
  console.log(text, attempt(() => sumOfList(listOf(), unseen(text))));
}

function sumOfMap(map, deed) {
  let sum = 0;
  for (const [key, value] of map) {
    if (key === "b") deed(map);
    sum += value;
  }
  return sum + map.size;
}
const mapOf = () => new Map([["a", 1], ["b", 2], ["c", 3]]);
for (const text of ["m => { m.set('c', 'text'); }", "m => { m.delete('c'); }", "m => { m.set('d', 4n); }", "m => { m.clear(); }", "m => { m.set({}, { valueOf() { return 5; } }); }"]) {
  console.log(text, attempt(() => sumOfMap(mapOf(), unseen(text))));
}
