const keyOfX: string = JSON.parse('"x"');
const keyOfExtra: string = JSON.parse('"extra"');
const keyOfZero: string = JSON.parse('"0"');
const turns: number = JSON.parse("3");
class Base {
  x = 1;
}
class Derived extends Base {
  y = 2;
}
function read(base: Base) {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += base.x ?? 50;
  return total;
}
function empty(base: Base) {
  delete (base as any).x;
}
const bases: Base[] = [new Base(), new Derived(), new Derived()];
console.log(bases.map(read).join());
empty(bases[1]);
console.log(bases.map(read).join(), bases.map(base => "x" in base).join(), bases.map(base => Object.keys(base).join("+")).join());
