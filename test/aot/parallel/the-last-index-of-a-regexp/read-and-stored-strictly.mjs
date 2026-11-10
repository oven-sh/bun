const set = (r, v) => { r.lastIndex = v; }, get = r => r.lastIndex;
const a = /a/g, b = /b/g;
for (let i = 0; i < 100; i++) { set(a, i); set(b, i); get(a); get(b); }
Object.freeze(b);
let e = "", refused = 0;
try { set(b, 1); } catch (x) { e = x.name; }
for (let i = 0; i < 100; i++) { try { set(b, i); } catch (x) { refused += x.name === "TypeError"; } }
console.log(refused, get(b));
const c = /c/g, d = /d/g;
Object.defineProperty(d, "lastIndex", { value: 4, writable: false });
let held = 0;
for (let i = 0; i < 100; i++) { set(c, i); try { set(d, i); } catch (x) { held += x.name === "TypeError"; } }
console.log(held, get(c), get(d));
set(a, { valueOf: () => 2 });
const hit = a.exec("aaaa").index, after = get(a);
set(a, "x");
console.log(get(b), e, hit, after, get(a), a.exec("ba").index, "lastIndex" in a, Object.hasOwn(a, "lastIndex"), Object.keys(a).length);
const call = r => r.lastIndex();
let errors = 0;
for (let i = 0; i < 100; i++) { try { call(a); } catch (x) { errors += x.name === "TypeError"; } }
console.log(errors);
