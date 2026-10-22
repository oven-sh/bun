const subject = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
const result = subject.format(1.5);
console.log(typeof result);
