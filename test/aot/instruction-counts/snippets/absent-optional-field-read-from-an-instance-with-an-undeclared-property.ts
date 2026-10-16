// reads a declared optional field that is absent from an instance that has an undeclared property; its class is extended by its value
var Base = class {
  declare host?: string;
  always = 1;
};
class Heir extends Base {}
const operations = 100;
const makeHeir = (i: number) => {
  const heir = new Heir();
  (heir as any).tag = i;
  return heir;
};
const all = [makeHeir(0)];
for (let i = 1; i < operations; i++) all.push(makeHeir(i));
let total = 0;

kernel: {
  for (let i = 0; i < all.length; i++) {
    if (all[i].host === undefined) total++;
  }
}

console.log(total);
