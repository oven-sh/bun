// Function properties: compiled answers as plain.
function f(a, b = 1, ...c) {}
const g = x => x,
  h = function () {},
  o = {
    m() {},
    get p() {
      return 1;
    },
    ["c" + 1]: () => {},
    [Symbol("s")]: function () {},
  };
console.log(
  f.length,
  f.name,
  g.name,
  h.name,
  o.m.name,
  Object.getOwnPropertyDescriptor(o, "p").get.name,
  o.c1.name,
  o[Object.getOwnPropertySymbols(o)[0]].name,
  f.bind().name,
  (() => {}).name === "",
  class {}.name === "",
  new Function("a", "return a").name,
  "prototype" in g,
  "prototype" in o.m,
  typeof f.prototype,
  f.hasOwnProperty("caller"),
);
