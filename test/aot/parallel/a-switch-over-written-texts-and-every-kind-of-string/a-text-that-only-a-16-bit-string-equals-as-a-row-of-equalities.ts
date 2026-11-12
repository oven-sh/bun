const texts: string[] = JSON.parse("[\"h\\u20acst-and-more\", \"h\\u20acst-and-mor!\", \"!\\u20acst-and-more\", \"h\\u20acst-and-mor\", \"H\\u20acST-AND-MORE\", \"h\\u20acst-a\\u0100d-more\", \"h\\u20acst-and-morex\", \"host-and-more\", \"host-and-mor!\", \"!ost-and-more\", \"host-and-mor\", \"HOST-AND-MORE\", \"host-a\\u0100d-more\", \"host-and-morex\", \"content-length\", \"content-lengt!\", \"!ontent-length\", \"content-lengt\", \"CONTENT-LENGTH\", \"content\\u0100length\", \"content-lengthx\"]");
const subjects: unknown[] = [];
for (const text of texts) {
  subjects.push(text);
  subjects.push(Buffer.from(text, "utf16le").toString("utf16le"));
  const half = text.length >> 1;
  subjects.push(text.slice(0, half) + text.slice(half));
  subjects.push((JSON.parse(JSON.stringify("<<" + text + ">>")) as string).slice(2, 2 + text.length));
  subjects.push((JSON.parse(JSON.stringify("\u20ac" + text)) as string).slice(1));
  subjects.push(Buffer.from(text.slice(0, half), "utf16le").toString("utf16le") + text.slice(half));
}
subjects.push(0, 1.5, -0, NaN, null, undefined, true, false, {}, [], ["host"], new String("host"), Symbol("host"), 10n, () => "host");
function isKnown(subject: unknown, depth: number): boolean {
  if (depth > 0) return isKnown(subject, depth - 1);
  return subject === "h\u20acst-and-more" || subject === "host-and-more" || subject === "content-length";
}
const answers: number[] = [];
for (const subject of subjects) answers.push(isKnown(subject, 1) ? 1 : 0);
console.log(answers.join(""));
