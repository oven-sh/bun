const keys: string[] = JSON.parse("[\"Akryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjq\", \"Bkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjq\", \"Ckryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjq\"]");
const texts: string[] = JSON.parse("[\"Akryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjq\", \"Bkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjq\", \"Ckryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjq\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjq\", \"Zkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjq\", \"Akryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqx\", \"Ckryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcj\", \"Akryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcj?\"]");
function kindsOf(text: string): unknown[] {
  const half = text.length >> 1;
  return [
    text,
    Buffer.from(text, "utf16le").toString("utf16le"),
    text.slice(0, half) + text.slice(half),
    (text.slice(0, half) + text.slice(half)).slice(0),
    (JSON.parse(JSON.stringify("<<" + text + ">>")) as string).slice(2, 2 + text.length),
    (JSON.parse(JSON.stringify("\u20ac" + text)) as string).slice(1),
    Buffer.from(text.slice(0, half), "utf16le").toString("utf16le") + text.slice(half),
  ];
}
function headOf(text: string, length: number): string { const head = text.slice(0, length); const half = head.length >> 1; return head.slice(0, half) + head.slice(half); }
function classify(subject: unknown, depth: number): number {
  if (depth > 0) return classify(subject, depth - 1);
  switch (subject) {
    case "Akryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjq": return 1;
    case "Bkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjq": return 2;
    case "Ckryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjqxelszgnubipwdkryfmtahovcjq": return 3;
    case "host": return 4;
    case "content-length": return 5;
    default: return 0;
  }
}
const answers: number[] = [];
for (const text of texts) {
  for (const subject of kindsOf(text)) {
    for (const key of keys) {
      for (const room of [32, 128]) {
        classify(headOf(key, room), 1);
        answers.push(classify(subject, 1));
      }
    }
  }
}
console.log(answers.join(""));
