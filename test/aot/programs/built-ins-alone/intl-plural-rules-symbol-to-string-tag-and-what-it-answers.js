const subject = new Intl.PluralRules("en");
const result = subject[Symbol.toStringTag];
console.log(typeof result);
