import vm from "node:vm";
const other = vm.runInNewContext("new Map([[1, 2]])");
const isOurs = (pair) => Object.getPrototypeOf(pair) === Array.prototype;
console.log("spread of the map", isOurs([...other][0]));
console.log("spread of entries()", isOurs([...other.entries()][0]));
console.log("Array.from of the map", isOurs(Array.from(other)[0]));
console.log("Array.from of entries()", isOurs(Array.from(other.entries())[0]));
const theirFrom = vm.runInNewContext("(map) => Array.from(map)");
console.log("their Array.from of our map", isOurs(theirFrom(new Map([[3, 4]]))[0]));
