"use strict";
function show(holder) {
  const found = Object.getOwnPropertyDescriptor(holder, "mark");
  const listed = [];
  for (const name in holder) listed.push(name);
  return [found.value, found.writable, found.enumerable, found.configurable, Object.keys(holder).join(), listed.join(), JSON.stringify(holder), Object.keys({ ...holder }).join(),
    holder.propertyIsEnumerable("mark"), Object.hasOwn(holder, "mark"), "mark" in holder, Object.getOwnPropertyNames(holder).join(), Object.isFrozen(holder), Object.isSealed(holder)].join(" ");
}
const a = {}; Object.defineProperty(a, "mark", { value: 1 });
const b = {}; Object.defineProperty(b, "mark", { value: 2, writable: true });
const c = {}; Object.defineProperty(c, "mark", { value: 3, enumerable: true });
const d = {}; Object.defineProperty(d, "mark", { value: 4, configurable: true });
const e = {}; Object.defineProperty(e, "mark", { value: 5, writable: true, enumerable: true });
const f = {}; Object.defineProperty(f, "mark", { value: 6, writable: true, configurable: true });
const g = {}; Object.defineProperty(g, "mark", { value: 7, enumerable: true, configurable: true });
const h = {}; Object.defineProperty(h, "mark", { value: 8, writable: true, enumerable: true, configurable: true });
let sum = 0;
for (let turn = 0; turn < 300; turn++) sum = (sum + a.mark + b.mark + c.mark + d.mark + e.mark + f.mark + g.mark + h.mark) | 0;
for (const holder of [a, b, c, d, e, f, g, h]) console.log(show(holder));
console.log(sum);
