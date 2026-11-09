// The name is made at run time: all that the language has is held.
const name = String.fromCharCode(109, 97, 112);
console.log([1, 2][name](value => value + 1).join());
