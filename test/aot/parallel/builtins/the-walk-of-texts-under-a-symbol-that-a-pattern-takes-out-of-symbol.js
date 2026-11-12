// This one stopped the build too: the receiver is a built-in holder, so the look has to name the key as well.
// STATISTIC: ImageFunctionsEmitted <= 8
const { iterator: stepsKey } = Symbol;
const walk = String.prototype[stepsKey].call("ab");
console.log(walk.next().value, walk.next().value, walk.next().done);
