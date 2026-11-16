const f = Object.freeze(/x/g), g = /x/g, set = (r, v) => { r.lastIndex = v; };
for (let i = 0; i < 100; i++) { set(g, i); set(f, i); }
const d = /y/;
Object.defineProperty(d, "lastIndex", { value: 4, writable: false });
set(d, 9);
console.log(g.lastIndex, f.lastIndex, d.lastIndex, delete g.lastIndex, g.lastIndex);
