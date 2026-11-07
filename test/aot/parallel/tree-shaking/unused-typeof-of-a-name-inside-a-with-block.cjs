// Inside `with` the `typeof` of a name looks the name up in the object, also where nothing uses what it gives: behind `&&`, `||`, `??` and in an arm of `?:`. The marked call makes the compiler ask what is left of each expression that nothing uses.
const seen = [];
const scope = new Proxy(
  {},
  {
    has(target, key) {
      if (/^p[0-9]$/.test(key)) seen.push(key);
      return false;
    },
  },
);
function pure() {}
/* @__PURE__ */ pure();
var yes = 1,
  no = 0,
  nothing = null;
with (scope) {
  yes && typeof p1;
  no || typeof p2;
  nothing ?? typeof p3;
  yes ? typeof p4 : typeof p5;
  {
    var p6;
    yes && typeof p6;
  }
  label: if (no) var p7;
  else yes && typeof p7;
}
console.log(seen.join(" "));
