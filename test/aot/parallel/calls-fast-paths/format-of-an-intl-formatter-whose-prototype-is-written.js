// Alone: what it prints depends on what else the executable holds: a member of a built-in object that another program calls cannot be written
// A program may replace the members of Intl.NumberFormat.prototype and Intl.DateTimeFormat.prototype, `format` among them. A call of `formatter.format(value)` that has formatted in line finds what the program has put there.
// IRT= 1 formatCount IsBuiltinLocationUnchanged member=IntlNumberFormatPrototypeFormat
// IRT= 1 formatCount CallBuiltin v[0-9]+, v[0-9]+ overload=IntlNumberFormatPrototypeFormat/
// IRT= 1 formatDay IsBuiltinLocationUnchanged member=IntlDateTimeFormatPrototypeFormat
// IRT= 1 formatDay CallBuiltin v[0-9]+, v[0-9]+ overload=IntlDateTimeFormatPrototypeFormat/
const count = new Intl.NumberFormat("en-US");
const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const say = run => {
  try {
    return String(run());
  } catch (error) {
    return "throws " + error.name;
  }
};
function formatCount(n) {
  return count.format(n + 0.5);
}
function formatDay(time) {
  return day.format(time * 86_400_000);
}
function formatBoth() {
  const texts = [];
  for (let n = 0; n < 3; n++) texts.push(say(() => formatCount(n * 1000)), say(() => formatDay(n)));
  return texts.join(" | ");
}
console.log("as created:", formatBoth());

// The other members, and names that the prototype objects do not have.
const replacement = function () {
  return "replaced";
};
for (const prototype of [Intl.NumberFormat.prototype, Intl.DateTimeFormat.prototype]) {
  for (const name of ["formatToParts", "formatRange", "formatRangeToParts", "resolvedOptions", "added"]) {
    const before = Object.getOwnPropertyDescriptor(prototype, name);
    console.log(name, say(() => ((prototype[name] = replacement), prototype[name] === replacement)));
    if (before) Object.defineProperty(prototype, name, before);
    else delete prototype[name];
  }
}
Intl.NumberFormat.prototype.formatToParts = replacement;
console.log(count.formatToParts(1), formatBoth());
delete Intl.NumberFormat.prototype.formatToParts;
console.log(say(() => count.formatToParts(1)), formatBoth());

// `format` itself: another accessor, a function, nothing, and the accessor of the engine again.
const numberFormat = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, "format");
const dateFormat = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "format");
console.log(typeof numberFormat.get, numberFormat.set, numberFormat.enumerable, numberFormat.configurable);
Object.defineProperty(Intl.NumberFormat.prototype, "format", {
  get() {
    return n => "counted " + n + " by " + (this === count);
  },
  configurable: true,
});
console.log("another accessor:", formatBoth());
Object.defineProperty(Intl.DateTimeFormat.prototype, "format", { value: time => "day " + time / 86_400_000, configurable: true, writable: true });
console.log("a function:", formatBoth());
Intl.DateTimeFormat.prototype.format = function (time) {
  return "assigned " + (this === day) + " " + time;
};
console.log("assigned:", formatBoth());
delete Intl.NumberFormat.prototype.format;
delete Intl.DateTimeFormat.prototype.format;
console.log("deleted:", formatBoth(), "format" in count, "format" in day);
Object.defineProperty(Intl.NumberFormat.prototype, "format", numberFormat);
Object.defineProperty(Intl.DateTimeFormat.prototype, "format", dateFormat);
console.log("put back:", formatBoth());
console.log(new Intl.NumberFormat("de-DE").format(1234.5), new Intl.DateTimeFormat("de-DE", { timeZone: "UTC" }).format(0));
globalThis.kept = [formatCount, formatDay, formatBoth];
