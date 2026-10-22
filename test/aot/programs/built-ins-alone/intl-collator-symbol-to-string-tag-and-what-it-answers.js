const subject = new Intl.Collator("en");
const result = subject[Symbol.toStringTag];
console.log(typeof result);
