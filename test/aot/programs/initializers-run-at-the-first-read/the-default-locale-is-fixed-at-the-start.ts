// The default locale is fixed when the process starts: what the program stores in LANG, LC_ALL, LC_NUMERIC and their like changes neither Number.prototype.toLocaleString nor Intl.NumberFormat. A number that is written at the top level may therefore be written at the first read, which here comes behind the change, and is the first use of a locale in the compiled program.
const atTheStart = { text: (1234567.891).toLocaleString(), half: (0.5).toLocaleString(undefined), negative: (-98765.4321).toLocaleString() };
const named = { german: (1234567.891).toLocaleString("de-DE"), english: (1234567.891).toLocaleString("en-US") };

process.env.LANG = "fi_FI.UTF-8";
process.env.LANGUAGE = "fi";
process.env.LC_ALL = "fi_FI.UTF-8";
process.env.LC_NUMERIC = "fi_FI.UTF-8";
process.env.LC_CTYPE = "fi_FI.UTF-8";
process.env.LC_MESSAGES = "fi_FI.UTF-8";

function report(): void {
  const behindTheChange = { text: (1234567.891).toLocaleString(), half: (0.5).toLocaleString(undefined), negative: (-98765.4321).toLocaleString() };
  const locale = new Intl.NumberFormat().resolvedOptions().locale;
  console.log(JSON.stringify(behindTheChange) === JSON.stringify(atTheStart) ? "the same behind the change" : "DIFFERENT behind the change");
  console.log(locale.startsWith("fi") ? "the default locale FOLLOWS the environment" : "the default locale does not follow the environment");
  console.log(new Intl.NumberFormat(locale).format(1234567.891) === atTheStart.text ? "written the way of the default locale" : "NOT written the way of the default locale");
  console.log(atTheStart.text, atTheStart.half, atTheStart.negative, named.german, named.english);
}
setTimeout(report, 1);
