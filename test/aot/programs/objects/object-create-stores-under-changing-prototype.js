// Adjacent stores to an object created under a prototype, while setters and read-only properties come and go along its chain.
"use strict";
const base = { inherited: 0 };
let seen = [];
let created;

function fill(n) {
  const o = Object.create(base);
  created = o;
  o.a = n;
  o.b = n + 1;
  o.c = n + 2;
  o.d = n + 3;
  return o;
}
function show(what) {
  let errors = 0;
  for (let n = 0; n < 300; n++) {
    try {
      fill(n);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      errors++;
    }
  }
  console.log(what, Object.keys(created).join(), JSON.stringify(created), created.b, created.c, errors, seen.length, seen[seen.length - 1]);
  seen = [];
}

show("nothing inherited");
Object.defineProperty(base, "c", { set(value) { seen.push(value); }, configurable: true });
show("inherited setter");
delete base.c;
show("setter deleted");
Object.defineProperty(base, "b", { value: "fixed", writable: false, configurable: true });
show("inherited read-only property");
Object.defineProperty(base, "b", { value: "loose", writable: true });
show("inherited writable property");
const above = { set d(value) { seen.push(-value); } };
Object.setPrototypeOf(base, above);
show("setter above the prototype");
delete above.d;
show("setter above deleted");
Object.setPrototypeOf(base, new Proxy({}, { set(target, key, value, receiver) { seen.push(String(key)); return Reflect.set(target, key, value, receiver); } }));
show("proxy above the prototype");
Object.setPrototypeOf(base, null);
show("nothing above the prototype");
Object.freeze(base);
show("frozen prototype");

function fillWide(prototype, n) {
  const o = Object.create(prototype);
  o.a = n; o.b = n; o.c = n; o.d = n; o.e = n; o.f = n; o.g = n; o.h = n; o.i = n;
  return o;
}
const other = { inherited: 1 };
let sum = 0;
for (let n = 0; n < 3000; n++) {
  const o = fillWide(n % 3 ? other : null, n);
  sum += o.a + o.i + Object.keys(o).length;
}
console.log(sum);
