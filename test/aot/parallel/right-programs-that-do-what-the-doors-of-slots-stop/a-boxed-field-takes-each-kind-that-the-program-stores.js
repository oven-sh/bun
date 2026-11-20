function read(box) { const inner = box.inner; return typeof inner === "object" && inner !== null ? inner.n : String(inner); }
const seen = [];
const box = { inner: { n: 1 } };
seen.push(read(box));
box.inner = { n: 2 };
seen.push(read(box));
box.inner = "text";
seen.push(read(box));
box.inner = undefined;
seen.push(read(box));
box["in" + "ner"] = 7;
seen.push(read(box));
Object.assign(box, { inner: null });
seen.push(read(box));
const small = { only: function first() { return 1; } };
small.only = function second() { return 2; };
seen.push(small.only());
console.log(seen.join());
