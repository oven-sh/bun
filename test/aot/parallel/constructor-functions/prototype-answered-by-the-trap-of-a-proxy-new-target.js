// The new target is a proxy. The engine asks it for "prototype", and what the `get` trap answers becomes the prototype of the new object.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
function A() {
  this.r = typeof this.m;
}
A.prototype.m = function () {
  return "A.m";
};
const given = { __proto__: A.prototype };
const B = new Proxy(function () {}, {
  get(target, key) {
    return key === "prototype" ? given : target[key];
  },
});
given.d = "from prototype";
for (let i = 0; i < 4; i++) {
  const o = Reflect.construct(A, [], B);
  // Only strings are printed, so the new object and its prototype reach no code outside this file.
  console.log(
    typeof o.r + " " + typeof o.d + " " + (o instanceof A) + " " + (Object.getPrototypeOf(o) === A.prototype),
  );
}
given.late = "added after objects inherit";
console.log(typeof Reflect.construct(A, [], B).late);
