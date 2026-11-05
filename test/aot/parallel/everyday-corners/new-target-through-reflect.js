// New target through reflect: compiled answers as plain.
function F() {
  return new.target === undefined ? "call" : new.target.name;
}
class G {}
console.log(
  F(),
  typeof new F(),
  Reflect.construct(
    function () {
      this.n = new.target.name;
    },
    [],
    G,
  ).n,
  Reflect.construct(function () {}, [], G) instanceof G,
);
