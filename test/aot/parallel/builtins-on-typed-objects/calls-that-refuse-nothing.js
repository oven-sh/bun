// Calls of built-ins whose operands are within bounds throw nothing and run no code, so an unread one is dead code; one step outside the bounds they throw as in plain Bun.
const log = [];
function attempt(label, run) {
  let answer;
  try {
    answer = run();
  } catch (error) {
    answer = error.constructor.name;
  }
  console.log(label, typeof answer === "string" ? JSON.stringify(answer) : String(answer), "|", log.splice(0).join());
}
const note = (label, value) => (log.push(label), value);
const number = () => 1234567.891 + (log.length ? 1 : 0);
const text = () => "straße" + (log.length ? "!" : "");

// In a locale that the call names the text is the same everywhere. The host's own locale and time zone are left out of what is printed.
for (const tag of ["en-US", "de-DE", "fr-FR", "en-IN", "ja-JP", "ar-EG", "hi-IN", "und", "en-u-nu-thai", "zz", "EN-us", "x y", "", "en_US", "a", "i-klingon", "en-US-u-ca"]) {
  attempt(`a number in ${JSON.stringify(tag)}`, () => number().toLocaleString(tag));
  attempt(`a bigint in ${JSON.stringify(tag)}`, () => 12345678901234567890n.toLocaleString(tag));
  attempt(`upper case in ${JSON.stringify(tag)}`, () => text().toLocaleUpperCase(tag));
  attempt(`compared in ${JSON.stringify(tag)}`, () => text().localeCompare("strasse", tag));
  attempt(`a formatter in ${JSON.stringify(tag)}`, () => new Intl.NumberFormat(tag).format(1234.5));
  attempt(`a day in ${JSON.stringify(tag)}`, () => new Date(Date.UTC(2020, 1, 3)).toLocaleDateString(tag, { timeZone: "UTC" }));
}
attempt("constants, en-US", () => [(1234567.891).toLocaleString("en-US"), (0).toLocaleString("en-US"), (-0).toLocaleString("en-US"), NaN.toLocaleString("en-US"), Infinity.toLocaleString("en-US"), (-Infinity).toLocaleString("en-US"), (1e21).toLocaleString("en-US"), (1e-7).toLocaleString("en-US"), (0.5555).toLocaleString("en-US"), (2 ** 53).toLocaleString("en-US"), (-1234.5).toLocaleString("en-US")].join(" "));
attempt("constants, other locales", () => [(1234567.891).toLocaleString("de-DE"), (1234567.891).toLocaleString("fr-FR"), (1234567.891).toLocaleString("en-IN"), (1234567.891).toLocaleString("de-CH"), (1234567.891).toLocaleString("ar-EG"), (1234.5).toLocaleString("es-ES"), (1234.5).toLocaleString("pl-PL")].join(" "));
const LIMIT = 10485760;
const TABLE = { size: `at most ${LIMIT.toLocaleString("en-US")} bytes`, count: `${(25000).toLocaleString("en-US")} files` };
attempt("constants in a table", () => `${TABLE.size}, ${TABLE.count}`);
attempt("a constant, a tag that is refused", () => (1).toLocaleString("x y"));
attempt("a constant, options", () => (0.256).toLocaleString("en-US", { style: "percent" }));
attempt("a constant, options that are undefined", () => (1234.5).toLocaleString("en-US", undefined));
attempt("a constant, options that are refused", () => (1).toLocaleString("en-US", { style: "none" }));
attempt("a constant, options that are null", () => (1).toLocaleString("en-US", null));
attempt("a constant, a list of tags", () => (1234.5).toLocaleString(["de-DE", "en-US"]));
attempt("a constant, an object as the tag", () => (1234.5).toLocaleString({ toString: () => note("toString", "de-DE") }));
attempt("a constant, null as the tag", () => (1234.5).toLocaleString(null));
attempt("a constant, a number as the tag", () => (1234.5).toLocaleString(5));
attempt("options with a getter", () => (1).toLocaleString("en-US", { get style() { return note("style", "decimal"); } }));
attempt("the host's locale answers a text", () => typeof number().toLocaleString() + typeof new Date().toLocaleString() + typeof new Date().toLocaleTimeString() + typeof 5n.toLocaleString());
attempt("a day that is none", () => new Date(NaN).toLocaleString() + new Date(NaN).toLocaleDateString("en-US"));
attempt("another receiver", () => Number.prototype.toLocaleString.call("5", "en-US"));
attempt("another receiver, no operands", () => Number.prototype.toLocaleString.call({}));
attempt("a wrapper", () => new Number(1234.5).toLocaleString("en-US"));
attempt("a date's function on another receiver", () => Date.prototype.toLocaleString.call({}));
attempt("a formatter without new", () => Intl.NumberFormat("en-US").format(1234.5));
attempt("a formatter of the host", () => typeof new Intl.NumberFormat().format(1) + typeof new Intl.DateTimeFormat().format(0));

for (const digits of [undefined, 0, 1, 2, 20, 100, 101, -1, 1.9, -0.5, NaN, Infinity, "3", "x", null, true, { valueOf: () => note("valueOf", 2) }, 1n]) {
  const name = typeof digits === "bigint" ? "1n" : typeof digits === "object" && digits ? "object" : String(digits);
  attempt(`toFixed ${name}`, () => (1234.5678).toFixed(digits));
  attempt(`toPrecision ${name}`, () => (1234.5678).toPrecision(digits));
  attempt(`toExponential ${name}`, () => (1234.5678).toExponential(digits));
  attempt(`toString ${name}`, () => (255.5).toString(digits));
  attempt(`padStart ${name}`, () => "ab".padStart(digits, "xy"));
  attempt(`padEnd ${name}`, () => "ab".padEnd(digits));
}
attempt("written counts", () => [number().toFixed(0), number().toFixed(2), number().toFixed(100).length, number().toPrecision(1), number().toPrecision(100).length, number().toExponential(0), number().toExponential(100).length, number().toString(2), number().toString(36), number().toString(10)].join(" "));
attempt("toFixed(101)", () => number().toFixed(101));
attempt("toFixed(-1)", () => number().toFixed(-1));
attempt("toPrecision(0)", () => number().toPrecision(0));
attempt("toPrecision(101)", () => number().toPrecision(101));
attempt("toExponential(101)", () => number().toExponential(101));
attempt("toExponential(-1)", () => number().toExponential(-1));
attempt("toString(1)", () => number().toString(1));
attempt("toString(37)", () => number().toString(37));
attempt("what is no finite number", () => [NaN.toFixed(2), Infinity.toFixed(2), NaN.toPrecision(101), Infinity.toExponential(-1), (1e21).toFixed(2), NaN.toString(2)].join(" "));
attempt("what is no finite number, a count that is refused", () => NaN.toFixed(101));
attempt("what is no finite number, a radix that is refused", () => NaN.toString(1));
attempt("a long pad", () => text().padStart(2 ** 20).length);
attempt("a pad no string can have", () => text().padStart(2 ** 31).length);
attempt("a pad no string can have, more", () => text().padEnd(2 ** 32, "ab").length);
attempt("a pad with nothing", () => text().padStart(2 ** 31, ""));
attempt("a negative pad", () => text().padStart(-(2 ** 31)) + text().padEnd(-5, "x"));
attempt("a filler that is converted", () => "a".padStart(3, { toString: () => note("toString", "z") }));
for (const form of [undefined, "NFC", "NFD", "NFKC", "NFKD", "nfc", "", "NFX", null, 5, { toString: () => note("toString", "NFD") }]) attempt(`normalize ${typeof form === "object" && form ? "object" : String(form)}`, () => "é ﬁ".normalize(form).length);
attempt("receivers that are refused", () => String.prototype.normalize.call(null));
attempt("receivers that are refused, upper case", () => String.prototype.toLocaleUpperCase.call(undefined));
attempt("receivers that are converted", () => String.prototype.padStart.call({ toString: () => note("toString", "r") }, 3, "-") + String.prototype.localeCompare.call(5, "5", "en") + String.prototype.toLocaleLowerCase.call(true));

function unread(value, digits, tag, word) {
  value.toFixed(digits);
  value.toString(digits);
  value.toLocaleString(tag);
  word.normalize(tag);
  word.padStart(digits * 1e9);
  return "nothing was refused";
}
attempt("nobody reads the answers", () => unread(1.5, 2, "en", "w"));
attempt("nobody reads the answers: the count is refused", () => unread(1.5, 101, "en", "w"));
attempt("nobody reads the answers: the radix is refused", () => unread(1.5, 1, "en", "w"));
attempt("nobody reads the answers: the tag is refused", () => unread(1.5, 2, "x y", "w"));
attempt("nobody reads the answers: the form is refused", () => unread(1.5, 2, "de", "w"));
attempt("nobody reads the answers: the length is refused", () => unread(1.5, 36, "en", "w"));
function unreadAndWritten(value, word) {
  value.toFixed(2); value.toPrecision(3); value.toExponential(4); value.toString(16); value.toLocaleString(); value.toLocaleString("en-US");
  word.normalize(); word.normalize("NFKC"); word.padStart(9); word.padEnd(9, "."); word.toLocaleUpperCase(); word.toLocaleLowerCase("tr"); word.localeCompare("b"); word.localeCompare("b", "sv");
  new Date(0).toLocaleString(); new Date(0).toLocaleDateString("en-GB"); new Intl.NumberFormat(); new Intl.DateTimeFormat("ja-JP");
  return "done";
}
attempt("nobody reads the answers, and nothing can be refused", () => unreadAndWritten(number(), text()));
attempt("nobody reads the answers, and the receiver is refused", () => unreadAndWritten(null, text()));
attempt("nobody reads the answers, and the receiver has its own", () => unreadAndWritten({ toFixed: () => note("own toFixed"), toPrecision() {}, toExponential() {}, toString() {}, toLocaleString: () => note("own toLocaleString") }, text()));
