class Crate {
  1 = "one";
}
const crate = new Crate();
const word = String(JSON.parse('"1"'));
const { [+word]: found } = crate;
console.log(found);
