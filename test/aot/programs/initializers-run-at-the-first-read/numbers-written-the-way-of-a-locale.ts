// Numbers written the way of a locale: with a name that is none, with options that run code, on what is no number.
const log: string[] = [];
const plain = { text: (1234567.891).toLocaleString(), pad: [1, 2, 3] };
const named = { text: (1234567.891).toLocaleString("de-DE"), other: (0.5).toLocaleString("en-US", undefined) };
let thrown = "none";
function bad(tag: string) { try { return (1).toLocaleString(tag); } catch (error) { thrown = (error as Error).name; return "bad"; } }
const invalid = { text: bad("not a tag") };
const options = { get maximumFractionDigits() { log.push("options read"); return 1; } };
const withOptions = { text: (1.25).toLocaleString("en-US", options) };
const odd = { toLocaleString() { log.push("own method"); return "odd"; } };
const onObject = { text: odd.toLocaleString() };
const big = { text: (12345678901234567890n).toLocaleString("en-US") };
log.push("start is over", thrown);
console.log(JSON.stringify([plain, named, invalid, withOptions, onObject, big, log]));
