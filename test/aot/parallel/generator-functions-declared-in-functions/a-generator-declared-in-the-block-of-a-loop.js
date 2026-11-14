// one function a turn of the loop. plain: true true true | false false | 0 1 2
const n = +process.argv[2] || 3;
const above = made => Object.getPrototypeOf(made);
function f() {
  "use strict";
  const turns = [];
  for (let i = 0; i < n; i++) {
    function* gen() { yield i; }
    turns.push([() => gen(), () => gen()]);
  }
  const within = turns.map(([a, b]) => above(a()) === above(b())).join(" ");
  const across = [above(turns[0][0]()) === above(turns[1][0]()), above(turns[1][1]()) === above(turns[2][0]())].join(" ");
  return within + " | " + across + " | " + turns.map(([a]) => a().next().value).join(" ");
}
console.log(f());
