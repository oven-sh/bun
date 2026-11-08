// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const double = function (count) {
  return count * 2;
};
let holder = double;
let described;
while (holder && !(described = Object.getOwnPropertyDescriptor(holder, "call"))) holder = Object.getPrototypeOf(holder);
console.log(Reflect.apply(described.value, double, [undefined, 4]));
