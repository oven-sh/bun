// Flags: --define=import.meta.hot=outer.hot --define=import.meta.hot.data=inner.data
// Reference: bun build --compile
const inner = { data: "inner" };
const outer = { hot: { data: "outer", accept: () => "accepted" } };
console.log("in front", import.meta.hot["data"], import.meta.hot.data, import.meta.hot["accept"](), typeof import.meta.hot);
