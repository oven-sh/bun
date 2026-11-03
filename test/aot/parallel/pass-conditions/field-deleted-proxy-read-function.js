// A function makes objects with three fields and is run again for one of them. A field of numbers is deleted through a proxy around the object, and read afterwards.
function Maker(seed, between) {
  this.c = seed + 2;
  this.b = between(seed);
  this.a = seed;
}
function total(it) {
  return it.c + 1 + "|" + it.b + "|" + it.a + "|" + it.c;
}
const said = [];
for (let at = 0; at < 6; at++) {
  const made = new Maker(at, seed => "b" + seed);
  said.push(total(made));
  const veil = new Proxy(made, {});
  if (at % 3 === 1) {
    Maker.call(made, 40, () => {
      delete veil.c;
      return "again";
    });
    said.push(total(made), Object.keys(made).join("+"));
  }
  if (at % 3 === 2) {
    delete veil.c;
    said.push(total(made), Object.keys(made).join("+"));
  }
}
console.log(said.join(" "));
