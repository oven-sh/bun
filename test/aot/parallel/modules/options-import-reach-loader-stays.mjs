// Options of an import reach the loader of what stays outside the executable.
const load = (how, f) =>
  Promise.resolve()
    .then(f)
    .then(
      m => console.log(how + ":", JSON.stringify(m.default ?? m), Object.keys(m).join()),
      e => console.log(how + ": refused:", e.constructor.name, e.code, String(e.message).slice(0, 110)),
    );
await load("file", () => import("data:application/octet-stream,27", { with: { type: "file" } }));
await load("css", () => import("data:text/css,a{color:red}", { with: { type: "css" } }));
const options = { with: { type: "json" } };
await load("options in a variable", () => import('data:application/json,{"a":34}', options));
const text = { with: { type: "text" } };
await load("the same text by other options", () => import('data:application/json,{"a":34}', text));
let reads = [];
const watched = {
  get with() {
    reads.push("with");
    return {
      get type() {
        reads.push("type");
        return "json";
      },
    };
  },
};
await load("options with getters", () => import('data:application/json,{"a":35}', watched));
console.log(reads.join());
await load("options that are no object", () => import('data:application/json,{"a":36}', 1));
await load("attributes that are no object", () => import('data:application/json,{"a":37}', { with: 1 }));
await load("an attribute that is no string", () => import('data:application/json,{"a":38}', { with: { type: 1 } }));
await load("options that are undefined", () => import("data:text/javascript,export default 39", undefined));
await load("options without attributes", () => import("data:text/javascript,export default 40", {}));
await load("options that throw", () => import("data:text/javascript,export default 41", { get with() { throw new RangeError("thrown by a getter"); } }));
let order = [];
await load("the order of the arguments", () => import((order.push("specifier"), "data:text/javascript,export default 42"), (order.push("options"), {})));
console.log(order.join());
