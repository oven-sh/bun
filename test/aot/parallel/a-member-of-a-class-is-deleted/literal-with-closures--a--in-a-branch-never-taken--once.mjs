class Crate { constructor(size) { this.size = size; } }
function wide(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return new Crate(n + work); }
function narrow(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return new Crate(n - work); }
const pick = Date.now() > 5 ? wide : narrow;
function one() {
  let count = 5;
  let said = "";
  const o = { a: 1, b: "s", m: () => ++count, c: pick(3) };
  said = [typeof o.a, typeof o.b, typeof o.c, "a" in o, "b" in o, "c" in o, Object.keys(o).join(""), JSON.stringify(o), String(o.m())].join(" ");
  if (Date.now() < 5) delete o.a;
  said += " | " + [typeof o.a, typeof o.b, typeof o.c, "a" in o, "b" in o, "c" in o, Object.keys(o).join(""), JSON.stringify(o), String(o.m())].join(" ");
  return said + " " + count;
}
console.log(one());
