// The argument of a call marked `/* @__PURE__ */` has a getter that prints.
const a = /* @__PURE__ */ String({ get x() { console.log("the getter ran"); } }.x);
console.log("end");
