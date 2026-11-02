// Stores to a defined name whose `--define` value is one name change the `let` of the file that has that name, and inside a function the name reads the parameter of that name.
// Flags: --define NAME=target
let target = 0;
NAME = 1;
NAME++;
NAME += 5;
console.log(target, typeof globalThis.target);
function read(target) {
  return NAME;
}
console.log(read("the parameter"));
