const subject = { first: 1, second: 2 };
const result = subject.__lookupGetter__("an");
console.log(typeof result, result === undefined);
