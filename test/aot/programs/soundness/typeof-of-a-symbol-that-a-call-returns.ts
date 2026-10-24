// typeof is the only use of the symbol that a call returns; built with validation, which tests the value against its proven type.
function make() { return Symbol("dog"); }
console.log(typeof make());
