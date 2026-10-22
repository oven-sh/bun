const subject = new Intl.NumberFormat("en");
const result = subject[Symbol.toStringTag];
console.log(typeof result);
