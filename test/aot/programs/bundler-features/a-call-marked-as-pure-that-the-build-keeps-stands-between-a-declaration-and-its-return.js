// A build that ignores the marks on calls runs a marked call, also between the declaration of a variable and the `return` that gives it back.
let n = 0;
function f() {
  return "made";
}
function g() {
  n++;
}
function h() {
  const a = f();
  /* @__PURE__ */ g();
  return a;
}
console.log(h(), n);

class Counted {
  constructor() {
    n++;
  }
}
function constructs() {
  const a = f();
  /* @__PURE__ */ new Counted();
  return a;
}
console.log(constructs(), n);
