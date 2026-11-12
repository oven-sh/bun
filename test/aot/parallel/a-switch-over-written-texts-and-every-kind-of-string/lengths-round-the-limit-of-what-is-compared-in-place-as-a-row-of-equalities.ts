const texts: string[] = JSON.parse("[\"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\", \"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx!\", \"!xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\", \"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\", \"XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\", \"xxxxxxxxxxxxxxx\\u0100xxxxxxxxxxxxxxx\", \"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\", \"yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy\", \"yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy!\", \"!yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy\", \"yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy\", \"YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY\", \"yyyyyyyyyyyyyyyy\\u0100yyyyyyyyyyyyyyy\", \"yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyx\", \"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\", \"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz!\", \"!zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\", \"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\", \"ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ\", \"zzzzzzzzzzzzzzzz\\u0100zzzzzzzzzzzzzzzz\", \"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzx\", \"wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww\", \"wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww!\", \"!wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww\", \"wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww\", \"WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW\", \"wwwwwwwwwwwwwwwwwwww\\u0100wwwwwwwwwwwwwwwwwww\", \"wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwx\", \"yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy?\", \"!yyyyyyyyyyyyyyyyyyyyyyyyyyyyyy!\", \"YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY!\", \"yyyyyyyyyyyyyyyy\\u0100yyyyyyyyyyyyyy!\", \"yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy!x\", \"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz?\", \"!zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz!\", \"ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ!\", \"zzzzzzzzzzzzzzzz\\u0100zzzzzzzzzzzzzzz!\", \"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz!x\"]");
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
  return subject === "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" || subject === "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy" || subject === "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" || subject === "wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww" || subject === "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy!" || subject === "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz!";
}
const answers: number[] = [];
for (const subject of subjects) answers.push(isKnown(subject, 1) ? 1 : 0);
console.log(answers.join(""));
