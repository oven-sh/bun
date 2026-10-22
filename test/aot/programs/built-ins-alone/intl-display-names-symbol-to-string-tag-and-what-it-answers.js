const subject = new Intl.DisplayNames("en", { type: "region" });
const result = subject[Symbol.toStringTag];
console.log(typeof result);
