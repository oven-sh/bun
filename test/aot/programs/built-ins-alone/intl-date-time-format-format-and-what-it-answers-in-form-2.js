const subject = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
const result = subject.format;
console.log(typeof result, result.length);
