class Crate {
  mass = 3;
}
const crate = new Crate();
crate[undefined] += 1;
crate[null]++;
crate[true] ??= 7;
console.log(crate.undefined, crate.null, crate.true);
