const subject = new Intl.DurationFormat("en");
const result = subject[Symbol.toStringTag];
console.log(typeof result);
