const subject = new Intl.Segmenter("en");
const result = subject[Symbol.toStringTag];
console.log(typeof result);
