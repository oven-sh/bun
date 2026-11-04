// fields that hold closures over different environments, in a base class and in the class below it, made in factories: each closure keeps the environment that it was made in
function family(tag) {
  class Base { constructor(k) { const own = tag + k; this.say = () => own + ":base"; } }
  class Below extends Base { constructor(k) { super(k); const mine = k + tag; this.say2 = () => mine + ":below"; this.both = () => this.say() + this.say2(); } }
  class Other extends Base { constructor(k) { super(k); const mine = "o" + k; this.say = () => mine + ":over"; } }
  return [Base, Below, Other];
}
const out = [];
for (const tag of ["a", "b"]) {
  const [Base, Below, Other] = family(tag);
  for (let k = 0; k < 3; k++) { const x = new Base(k), y = new Below(k), z = new Other(k); out.push(x.say(), y.say(), y.say2(), y.both(), z.say()); }
}
console.log(out.join(" "));
