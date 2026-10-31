// A function stores through a defined name whose `--define` value is one name to the `let` of the file that has that name. `delete` of the defined name is not replaced.
// Flags: --define NAME=target
let target = "the initializer";
function store(value) {
  NAME = value;
}
store("stored through the define");
console.log(target, NAME, typeof NAME, delete NAME);
