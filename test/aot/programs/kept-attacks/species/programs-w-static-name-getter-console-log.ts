// console.log names the class of what it prints: native code reads `constructor` of the instance and `name` of the class.
let reads = 0;
class Named { static get name(): string { reads++; return "Custom"; } }
console.log(new Named());
console.log(reads > 0);
