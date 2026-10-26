const load = (how, f) =>
  Promise.resolve()
    .then(f)
    .then(
      m => console.log(how + ":", JSON.stringify(m.default ?? m), Object.keys(m).join()),
      e => console.log(how + ": refused:", e.constructor.name, e.code, String(e.message).slice(0, 110)),
    );
await load("no options", () => import("./other.mjs"));
await load("options that are no object", () => import("./other.mjs", 1));
await load("attributes that are no object", () => import("./other.mjs", { with: 1 }));
await load("an attribute that is no string", () => import("./other.mjs", { with: { type: 1 } }));
let reads = [];
await load("getters", () => import("./other.mjs", { get with() { reads.push("with"); return { get kind() { reads.push("kind"); return "a"; } }; } }));
console.log(reads.join());
await load("a getter that throws", () => import("./other.mjs", { get with() { throw new RangeError("thrown by a getter"); } }));
await load("as text", () => import("./other.mjs", { with: { type: "text" } }));
await load("null", () => import("./other.mjs", null));
await load("undefined", () => import("./other.mjs", undefined));
await load("a built-in module, no object", () => import("node:path", 1).then(m => ({ default: typeof m.join })));
