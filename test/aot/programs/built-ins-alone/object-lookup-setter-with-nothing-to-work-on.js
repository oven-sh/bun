const subject = {};
const result = subject.__lookupSetter__("an");
console.log(typeof result, result === undefined);
