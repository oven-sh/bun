// `format` of an Intl.NumberFormat | DateTimeFormat is a getter that answers a function bound to the formatter, the same one each time.
// Each case is a function of its own; what the built-in answers is stored and read again right behind the call, and every question stands in place.
function formatOfNumberFormat() {
  const formatter = new Intl.NumberFormat("en");
  const format = formatter.format;
  const holder = { kept: format };
  const read = holder.kept;
  console.log("NumberFormat.format is", typeof format === "function", typeof format === "object", typeof format === "string", format === undefined, format === null);
  console.log("NumberFormat.format, again and read back:", formatter.format === format, read === format, typeof read === "function");
  console.log("NumberFormat.format, its own members:", typeof format.name === "string", format.name === "", typeof format.length === "number", format.length, Object.hasOwn(format, "prototype"));
  const text = format(1234.5);
  const texts = { kept: text };
  console.log("NumberFormat.format(1234.5) is", typeof text === "string", typeof text === "number", typeof text === "object", text === undefined, texts.kept, texts.kept.length);
}
function formatOfNumberFormatOverOperands() {
  const format = new Intl.NumberFormat("en").format;
  for (const operand of [0, -0, NaN, 12n, "7", undefined, null, true, { valueOf() { return 3; } }]) {
    const text = format(operand);
    console.log("NumberFormat.format of", typeof operand, "is a string:", typeof text === "string", text);
  }
  for (const text of [1, 2000].map(format)) console.log("mapped:", typeof text === "string", typeof text === "undefined", text);
  try { format(Symbol("no number")); console.log("no error"); } catch (error) { console.log("a symbol:", error instanceof TypeError, typeof error === "object"); }
}
function formatOfDateTimeFormat() {
  const formatter = new Intl.DateTimeFormat("en", { timeZone: "UTC" });
  const format = formatter.format;
  const holder = [format];
  const read = holder[0];
  console.log("DateTimeFormat.format is", typeof format === "function", typeof format === "object", format === undefined, formatter.format === format, read === format, format.length);
  const text = format(0);
  console.log("DateTimeFormat.format(0) is", typeof text === "string", typeof text === "object", text === undefined, text);
  const ofDate = format(new Date(86400000));
  console.log("DateTimeFormat.format(a Date) is", typeof ofDate === "string", ofDate);
  const now = format();
  console.log("DateTimeFormat.format() is", typeof now === "string", now.length > 0);
  try { format(NaN); console.log("no error"); } catch (error) { console.log("not a time:", error instanceof RangeError, error instanceof TypeError); }
}
function formatReadOffSomethingElse() {
  for (const holder of [Intl.NumberFormat.prototype, Intl.DateTimeFormat.prototype]) {
    const getter = Object.getOwnPropertyDescriptor(holder, "format").get;
    console.log("the getter is", typeof getter === "function", typeof getter === "undefined");
    try { const got = getter.call({}); console.log("no error", typeof got); } catch (error) { console.log("on an object that is no formatter:", error instanceof TypeError); }
    try { const got = holder.format; console.log("no error", typeof got); } catch (error) { console.log("on the prototype object:", error instanceof TypeError); }
  }
}
formatOfNumberFormat();
formatOfNumberFormatOverOperands();
formatOfDateTimeFormat();
formatReadOffSomethingElse();
