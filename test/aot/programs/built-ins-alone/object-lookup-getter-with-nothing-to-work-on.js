const subject = {};
const result = subject.__lookupGetter__("an");
console.log(typeof result, result === undefined);
