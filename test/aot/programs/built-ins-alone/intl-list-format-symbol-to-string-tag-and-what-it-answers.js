const subject = new Intl.ListFormat("en");
const result = subject[Symbol.toStringTag];
console.log(typeof result);
