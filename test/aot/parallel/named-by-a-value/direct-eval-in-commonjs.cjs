function helper() { return "helped"; }
var held = function () { return "held"; };
console.log(eval("helper() + ' ' + held()"));
