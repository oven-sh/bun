// A closure gets its prototype property at the first lookup of `prototype` or at its first construction. For the second closure of a constructor function
// that ends the guards of the class, so no test of the guards in front of such a read holds behind it. Built with --aot-validate, which repeats the test at each use.
// Flags: --aot-validate
const rows = [];
function row(name, run) { rows.push(name + ": " + JSON.stringify(run())); }

function made1() { function Message(url) { this.id = 1; this.url = url; } return Message; }
row("constructed in turn out of a list", () => {
  const list = [made1(), made1(), made1()]; const out = [];
  for (let round = 0; round < 3; round++) for (const C of list) out.push(new C("/" + round).url);
  return out;
});

function made2() { function Message(url) { this.id = 2; this.url = url; } return Message; }
row("the first constructs, the prototype of the others is read", () => {
  const list = [made2(), made2(), made2()]; const First = list[0]; const out = [];
  for (let round = 0; round < 3; round++) for (const C of list) { const a = new First("/a" + round); const p = C.prototype; const b = new First("/b" + round); out.push(a.url, typeof p, b.url, b.id); }
  return out;
});

function made3() { function Message(url) { this.id = 3; this.url = url; } return Message; }
row("the first constructs, the others stand right of instanceof", () => {
  const list = [made3(), made3(), made3()]; const First = list[0]; const out = [];
  for (let round = 0; round < 3; round++) for (const C of list) { const a = new First("/a" + round); const is = a instanceof C; const b = new First("/b" + round); out.push(is, b.url, b.id); }
  return out;
});

function made4() { function Message(url) { this.id = 4; this.url = url; } return Message; }
row("the first constructs, the others are asked whether they have one", () => {
  const list = [made4(), made4(), made4()]; const First = list[0]; const out = [];
  for (let round = 0; round < 3; round++) for (const C of list) { const a = new First("/a" + round); const has = Object.hasOwn(C, "prototype") && "prototype" in C; const b = new First("/b" + round); out.push(has, a.id, b.url); }
  return out;
});

function made5() { function Message(url) { this.id = 5; this.url = url; } return Message; }
row("the first constructs, the names of the others are listed", () => {
  const list = [made5(), made5(), made5()]; const First = list[0]; const out = [];
  for (let round = 0; round < 3; round++) for (const C of list) { const a = new First("/a" + round); const names = Object.getOwnPropertyNames(C).sort().join(); const b = new First("/b" + round); out.push(names, a.id, b.url); }
  return out;
});

function made6() { function Message(url) { this.id = 6; this.url = url; } return Message; }
row("the first constructs for the others as new.target", () => {
  const list = [made6(), made6(), made6()]; const First = list[0]; const out = [];
  for (let round = 0; round < 3; round++) for (const C of list) { const a = new First("/a" + round); const other = Reflect.construct(First, ["/r" + round], C); const b = new First("/b" + round); out.push(Object.getPrototypeOf(other) === C.prototype, other.url, a.id, b.url); }
  return out;
});

function made7() { function Message(url) { this.id = 7; this.url = url; } return Message; }
row("the key is computed", () => {
  const list = [made7(), made7(), made7()]; const First = list[0]; const keys = ["name", "prototype", "length"]; const out = [];
  for (let round = 0; round < 3; round++) for (const C of list) { const a = new First("/a" + round); const found = typeof C[keys[round]]; const b = new First("/b" + round); out.push(found, a.id, b.url); }
  return out;
});

function made8() { function Message(url) { this.id = 8; this.url = url; } return Message; }
function reads8(C) { return C.prototype; }
row("a function that is called reads it", () => {
  const list = [made8(), made8(), made8()]; const First = list[0]; const out = [];
  for (let round = 0; round < 3; round++) for (const C of list) { const a = new First("/a" + round); const p = reads8(C); const b = new First("/b" + round); out.push(typeof p, a.id, b.url); }
  return out;
});

for (const line of rows) console.log(line);
