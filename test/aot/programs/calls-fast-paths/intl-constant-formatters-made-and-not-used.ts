// A formatter made from constants and not used costs no call of ICU: whether the ICU that runs is the one that made the format
// patterns is asked when a pattern is first used, not when a formatter is made. Many programs make their formatters when a module
// is loaded. A named time zone is the exception: ICU says at the construction whether there is such a zone.
declare const aotOperationCount: undefined | ((name: string) => number);
const isCounted = typeof aotOperationCount === "function";
const comparisons = (): number => (isCounted ? aotOperationCount!("the ICU stamp of the format patterns is compared") : -1);
const isAsExpected = (expected: number): boolean => !isCounted || comparisons() === expected;

const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const offset = new Intl.DateTimeFormat("de", { dateStyle: "short", timeStyle: "short", timeZone: "+05:30" });
const money = new Intl.NumberFormat("fr", { style: "currency", currency: "EUR" });
console.log("three formatters are made, the stamp is not compared:", isAsExpected(0));
console.log(money.format(1234.5));
console.log("one is used, the stamp is compared:", isAsExpected(1));
console.log(date.format(0), offset.format(0), new Intl.NumberFormat("en-US").format(1234567), new Date(0).toLocaleDateString("es", { timeZone: "UTC" }));
console.log("once:", isAsExpected(1));
