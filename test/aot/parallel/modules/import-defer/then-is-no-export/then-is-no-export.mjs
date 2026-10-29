import defer * as t from "./exports-then.mjs";
console.log("main begins");
console.log(t.then, "then" in t, Reflect.getOwnPropertyDescriptor(t, "then"));
const resolved = await Promise.resolve(t);
console.log(resolved === t, "not evaluated yet");
console.log(t.other, t.then, Object.keys(t).join());
