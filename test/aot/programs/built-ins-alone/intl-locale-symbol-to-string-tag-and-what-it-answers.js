const subject = new Intl.Locale("en-US");
const result = subject[Symbol.toStringTag];
console.log(typeof result);
