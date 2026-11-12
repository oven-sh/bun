// This program stopped the build ("the program enters functions of Bun's library that the load has left out"): the load had brought what the one member needs,
// and the read was taken for one under a key that nobody knows, which asks for every member of String.prototype.
// STATISTIC: ImageFunctionsEmitted <= 8
const stepsKey = Symbol.iterator;
const walkOfTexts = String.prototype[stepsKey];
const walk = walkOfTexts.call("ab");
console.log(walk.next().value, walk.next().value, walk.next().done);
