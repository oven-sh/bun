const texts: string[] = JSON.parse("[\"contentAtype\", \"contentAtyp!\", \"!ontentAtype\", \"contentAtyp\", \"CONTENTATYPE\", \"conten\\u0100Atype\", \"contentAtypex\", \"contentBtype\", \"contentBtyp!\", \"!ontentBtype\", \"contentBtyp\", \"CONTENTBTYPE\", \"conten\\u0100Btype\", \"contentBtypex\"]");
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
const answers: number[] = [];
for (let i = 0; i < subjects.length; i++) {
  let answer = 0;
  switch (subjects[i]) {
    case "contentAtype": answer = 1; break;
    case "contentBtype": answer = 2; break;
  }
  answers.push(answer);
}
console.log(answers.join(""));
