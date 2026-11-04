// Who asks for the text is out of sight: evaluated code, Function.prototype.toString, a template, a sum.
class Crate { constructor(public load: number, private lid = "on") {} open() { return this.lid; } }
const ways: Array<(made: Function) => string> = [
  (0, eval)("(made) => String(made)"),
  (0, eval)("(made) => made.toString()"),
  (made) => Function.prototype.toString.call(made),
  (made) => `${made}`,
  (made) => made + "",
  (made) => Reflect.apply(Function.prototype.toString, made, []),
];
for (const way of ways) {
  const crate = new ((0, eval)("(" + way(Crate) + ")"))(12);
  console.log(JSON.stringify(crate), crate.open());
}
