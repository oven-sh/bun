// `sort` of strings: the result is right although the comparator defines a read-only indexed property on a prototype.
const p = {}; Object.create(p); let n = 0;
console.log(["c", "b", "a"].sort((x, y) => { if (++n === 2) Object.defineProperty(p, 0, { value: 7, writable: false }); return x < y ? -1 : x > y ? 1 : 0; }).join(), p[0]);
