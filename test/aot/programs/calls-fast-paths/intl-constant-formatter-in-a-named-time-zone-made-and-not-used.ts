// See intl-constant-formatters-made-and-not-used.ts: whether a time zone's name is valid depends on ICU's data, so the stamp is
// compared when a formatter in a named time zone is made.
declare const aotOperationCount: undefined | ((name: string) => number);
const isCounted = typeof aotOperationCount === "function";
const zoned = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });
console.log("the stamp is compared:", !isCounted || aotOperationCount!("the ICU stamp of the format patterns is compared") === 1);
console.log(zoned.format(0));
