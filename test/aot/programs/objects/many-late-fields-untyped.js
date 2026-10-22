// many-late-fields.ts without its types: what a field holds is what flow sees stored.
class Item {
  kind;
  next;
  constructor(kind) {
    this.kind = kind;
    this.next = undefined;
  }
}
const lines = [];
function log(...parts) {
  lines.push(parts.map((part) => typeof part === "object" && part !== null ? JSON.stringify(part) : String(part)).join(" "));
}
function fillA(item, i) {
  item.a0 = i;
  item.a1 = "a" + i;
  item.a2 = item;
  item.a3 = [i];
  item.a4 = (i & 1) === 0;
}
function fillB(item, i) {
  item.b9 = true;
  item.b5 = i + 0.5;
  item.b6 = "b" + i;
  item.b7 = item.next;
  item.b8 = [i, i];
}
function fillC(item, i) {
  item.c9 = false;
  item.c0 = -i;
}
function refill(item, i) {
  if (item.a0 !== undefined)
    item.a0 = i * 2;
  if (item.b5 !== undefined)
    item.b5 = i * 2;
  if (item.c0 !== undefined)
    item.c0 = i * 2;
  if (item.c9 !== undefined)
    item.c9 = true;
}
function count(value) {
  if (typeof value === "number")
    return value;
  if (typeof value === "string" || Array.isArray(value))
    return value.length;
  return value === undefined ? 0 : value.i;
}
function sum(item) {
  return count(item.a0) + count(item.a1) + (item.a2 === undefined ? 0 : 1) + count(item.a3) + (item.a4 ? 1 : 0) + count(item.b5) + count(item.b6) + (item.b7 === undefined ? 0 : 1) + count(item.b8) + (item.b9 ? 1 : 0) + count(item.c0) + (item.c9 === undefined ? 0 : 2);
}
const items = [];
let last = undefined;
for (let i = 0;i < 3000; ++i) {
  const item = new Item(i % 7);
  item.next = last;
  switch (i % 7) {
    case 0:
      fillA(item, i);
      break;
    case 1:
      fillB(item, i);
      break;
    case 2:
      fillC(item, i);
      break;
    case 3:
      fillC(item, i);
      fillA(item, i);
      break;
    case 4:
      fillB(item, i);
      fillC(item, i);
      fillA(item, i);
      break;
    case 5:
      break;
    default:
      item.c8 = [i];
      break;
  }
  items.push(item);
  last = item;
}
Bun.gc(true);
let total = 0;
for (const item of items)
  total += sum(item);
log("sum", total);
for (let i = 0;i < 7; ++i)
  log("keys", i, Object.keys(items[i]).join());
for (let i = 0;i < items.length; ++i)
  refill(items[i], i);
total = 0;
for (const item of items)
  total += sum(item);
log("refilled", total);
const loose = items;
for (let i = 0;i < loose.length; i += 3) {
  loose[i].a0 = "text" + i;
  loose[i].c7 = i;
  loose[i]["b" + i % 10] = { i };
}
Bun.gc(true);
let described = 0;
for (const item of loose)
  described += String(item.a0).length + String(item.c7).length + Object.keys(item).length;
log("other types", described);
for (let i = 0;i < 9; ++i)
  log("keys", i, Object.keys(loose[i]).join(), typeof loose[i].a0, typeof loose[i].b0, typeof loose[i].c7);
for (let i = 0;i < loose.length; i += 2) {
  delete loose[i].a0;
  delete loose[i].b9;
  delete loose[i].c9;
}
for (let i = 0;i < items.length; ++i)
  refill(items[i], i + 1);
for (let i = 0;i < items.length; i += 4) {
  fillC(items[i], i);
  fillB(items[i], i);
}
Bun.gc(true);
described = 0;
for (const item of loose)
  described += Object.keys(item).length + ("a0" in item ? 1 : 0) + ("b9" in item ? 2 : 0) + (Object.hasOwn(item, "c9") ? 4 : 0);
log("deleted and created again", described);
for (let i = 0;i < 9; ++i)
  log("keys", i, Object.keys(loose[i]).join());
log("entries", Object.entries(items[2]).map(([key, value]) => key + "=" + typeof value).join());
log("copy", Object.keys({ ...items[4] }).join(), Object.keys(Object.assign({}, items[3])).join());
const { next: ignoredNext, a2: ignoredSelf, b7: ignoredOther, ...rest } = items[4];
log("json", JSON.stringify(rest));
Object.freeze(items[8]);
try {
  fillA(items[8], 1);
  log("stored into a frozen object");
} catch (error) {
  log("frozen", error.constructor.name);
}
Object.defineProperty(items[9], "c1", { get() {
  return "getter";
}, enumerable: false, configurable: true });
log("accessor", items[9].c1, Object.keys(items[9]).includes("c1"));
console.log(lines.join(`
`));
