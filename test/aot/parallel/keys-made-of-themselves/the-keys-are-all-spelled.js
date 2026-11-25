// The control: nothing goes round: the keys are read.
function make(key) {
  return { [key]: 1 };
}
for (const name of Object.keys({ mark: 1, other: 2 })) Object.assign(Function.prototype, make(name));
console.log((() => 1).mark, (() => 1).other);
