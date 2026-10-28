// a.mjs with another built-in class.
let answer;
try { Object.freeze(Map.prototype); answer = "frozen"; } catch (error) { answer = error.name; }
console.log(answer + ", extensible " + Object.isExtensible(Map.prototype));
