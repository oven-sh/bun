const subject = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
const result = subject[Symbol.toStringTag];
console.log(typeof result);
