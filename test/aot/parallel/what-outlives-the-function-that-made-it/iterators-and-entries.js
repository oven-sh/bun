function firstEntry(o) { for (const entry of Object.entries(o)) return entry; }
function iterator(i) { const list = [{ v: i }]; return list[Symbol.iterator](); }
function own(i) { const o = { i, [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n++ > 0, value: o }) }; } }; return [...o][0]; }
console.log(firstEntry({ k: { v: 1 } })[1].v, iterator(2).next().value.v, own(3).i);
