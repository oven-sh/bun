// Two defines that begin at one name do not write over each other, and two at different names are both written.
// Flags: --define=import.meta.hot=outer.hot --define=import.meta.hot.data=inner.data --define=import.meta.a=inner.a --define=import.meta.k=outer.k
// Reference: bun build --compile
const inner = { data: "inner", a: "a" };
const outer = { hot: { data: "outer", accept: () => "accepted" }, k: "k" };
console.log("in front", import.meta.hot["data"], import.meta.hot.data, import.meta.hot["accept"](), typeof import.meta.hot);
console.log(/** @type {{ [import.meta.k]: 1, a: any }} */ (import.meta).a, import.meta.k);
