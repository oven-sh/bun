// The program freezes the prototype object of a built-in class.
let answer;
try { Object.freeze(Array.prototype); answer = "frozen"; } catch (error) { answer = error.name; }
console.log(answer + ", extensible " + Object.isExtensible(Array.prototype));
