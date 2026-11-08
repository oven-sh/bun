const registry = [];
function make(big) {
  let at = 0;
  const weak = new WeakRef(big);
  return { step: () => ++at, size: () => big.length + at, weak };
}
let made = make(new Array(1000).fill(1));
console.log(made.step(), made.size(), made.weak.deref().length);
const weak = made.weak;
made = null;
console.log(typeof weak.deref);
