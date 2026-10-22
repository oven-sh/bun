const subject = new Intl.RelativeTimeFormat("en");
const result = subject[Symbol.toStringTag];
console.log(typeof result);
