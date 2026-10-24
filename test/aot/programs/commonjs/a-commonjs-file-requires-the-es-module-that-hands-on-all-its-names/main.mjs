// ma.mjs hands on every name of mb.cjs, and mb.cjs requires ma.mjs half-way: the namespace object that the `require` answers lists what mb.cjs has exported by then.
const n = await import("./ma.mjs");
console.log("main", Object.keys(n).join(), n.first, n.second);
