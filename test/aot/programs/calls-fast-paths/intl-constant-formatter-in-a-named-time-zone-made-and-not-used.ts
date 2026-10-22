// See intl-constant-formatters-made-and-not-used.ts: whether a time zone's name is valid depends on ICU's data, so ICU is asked
// when a formatter in a named time zone is made.
const zoned = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });
console.log(zoned.format(0));
