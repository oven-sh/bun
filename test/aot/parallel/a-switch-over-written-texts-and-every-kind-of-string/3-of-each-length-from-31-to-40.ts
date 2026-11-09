const keys: string[][] = JSON.parse("[[\"dkryfmtahovcjqxAlszgnubipwdkryf\", \"dkryfmtahovcjqxBlszgnubipwdkryf\", \"dkryfmtahovcjqxClszgnubipwdkryf\"], [\"dkryfmtahovcjqxelszgnubipwdkryfA\", \"dkryfmtahovcjqxelszgnubipwdkryfB\", \"dkryfmtahovcjqxelszgnubipwdkryfC\"], [\"Akryfmtahovcjqxelszgnubipwdkryfmt\", \"Bkryfmtahovcjqxelszgnubipwdkryfmt\", \"Ckryfmtahovcjqxelszgnubipwdkryfmt\"], [\"dkryfmtahovcjqxelAzgnubipwdkryfmta\", \"dkryfmtahovcjqxelBzgnubipwdkryfmta\", \"dkryfmtahovcjqxelCzgnubipwdkryfmta\"], [\"dkryfmtahovcjqxelszgnubipwdkryfmtaA\", \"dkryfmtahovcjqxelszgnubipwdkryfmtaB\", \"dkryfmtahovcjqxelszgnubipwdkryfmtaC\"], [\"Akryfmtahovcjqxelszgnubipwdkryfmtaho\", \"Bkryfmtahovcjqxelszgnubipwdkryfmtaho\", \"Ckryfmtahovcjqxelszgnubipwdkryfmtaho\"], [\"dkryfmtahovcjqxelsAgnubipwdkryfmtahov\", \"dkryfmtahovcjqxelsBgnubipwdkryfmtahov\", \"dkryfmtahovcjqxelsCgnubipwdkryfmtahov\"], [\"dkryfmtahovcjqxelszgnubipwdkryfmtahovA\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahovB\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahovC\"], [\"Akryfmtahovcjqxelszgnubipwdkryfmtahovcj\", \"Bkryfmtahovcjqxelszgnubipwdkryfmtahovcj\", \"Ckryfmtahovcjqxelszgnubipwdkryfmtahovcj\"], [\"dkryfmtahovcjqxelszgAubipwdkryfmtahovcjq\", \"dkryfmtahovcjqxelszgBubipwdkryfmtahovcjq\", \"dkryfmtahovcjqxelszgCubipwdkryfmtahovcjq\"]]");
const texts: string[][] = JSON.parse("[[\"dkryfmtahovcjqxAlszgnubipwdkryf\", \"dkryfmtahovcjqxBlszgnubipwdkryf\", \"dkryfmtahovcjqxClszgnubipwdkryf\", \"dkryfmtahovcjqxelszgnubipwdkryf\", \"dkryfmtahovcjqxAlszgnubipwdkry?\"], [\"dkryfmtahovcjqxelszgnubipwdkryfA\", \"dkryfmtahovcjqxelszgnubipwdkryfB\", \"dkryfmtahovcjqxelszgnubipwdkryfC\", \"dkryfmtahovcjqxelszgnubipwdkryfm\", \"dkryfmtahovcjqxelszgnubipwdkryf?\"], [\"Akryfmtahovcjqxelszgnubipwdkryfmt\", \"Bkryfmtahovcjqxelszgnubipwdkryfmt\", \"Ckryfmtahovcjqxelszgnubipwdkryfmt\", \"dkryfmtahovcjqxelszgnubipwdkryfmt\", \"Akryfmtahovcjqxelszgnubipwdkryfm?\"], [\"dkryfmtahovcjqxelAzgnubipwdkryfmta\", \"dkryfmtahovcjqxelBzgnubipwdkryfmta\", \"dkryfmtahovcjqxelCzgnubipwdkryfmta\", \"dkryfmtahovcjqxelszgnubipwdkryfmta\", \"dkryfmtahovcjqxelAzgnubipwdkryfmt?\"], [\"dkryfmtahovcjqxelszgnubipwdkryfmtaA\", \"dkryfmtahovcjqxelszgnubipwdkryfmtaB\", \"dkryfmtahovcjqxelszgnubipwdkryfmtaC\", \"dkryfmtahovcjqxelszgnubipwdkryfmtah\", \"dkryfmtahovcjqxelszgnubipwdkryfmta?\"], [\"Akryfmtahovcjqxelszgnubipwdkryfmtaho\", \"Bkryfmtahovcjqxelszgnubipwdkryfmtaho\", \"Ckryfmtahovcjqxelszgnubipwdkryfmtaho\", \"dkryfmtahovcjqxelszgnubipwdkryfmtaho\", \"Akryfmtahovcjqxelszgnubipwdkryfmtah?\"], [\"dkryfmtahovcjqxelsAgnubipwdkryfmtahov\", \"dkryfmtahovcjqxelsBgnubipwdkryfmtahov\", \"dkryfmtahovcjqxelsCgnubipwdkryfmtahov\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahov\", \"dkryfmtahovcjqxelsAgnubipwdkryfmtaho?\"], [\"dkryfmtahovcjqxelszgnubipwdkryfmtahovA\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahovB\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahovC\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahovc\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahov?\"], [\"Akryfmtahovcjqxelszgnubipwdkryfmtahovcj\", \"Bkryfmtahovcjqxelszgnubipwdkryfmtahovcj\", \"Ckryfmtahovcjqxelszgnubipwdkryfmtahovcj\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahovcj\", \"Akryfmtahovcjqxelszgnubipwdkryfmtahovc?\"], [\"dkryfmtahovcjqxelszgAubipwdkryfmtahovcjq\", \"dkryfmtahovcjqxelszgBubipwdkryfmtahovcjq\", \"dkryfmtahovcjqxelszgCubipwdkryfmtahovcjq\", \"dkryfmtahovcjqxelszgnubipwdkryfmtahovcjq\", \"dkryfmtahovcjqxelszgAubipwdkryfmtahovcj?\"]]");
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
    case "dkryfmtahovcjqxAlszgnubipwdkryf": return 1;
    case "dkryfmtahovcjqxBlszgnubipwdkryf": return 2;
    case "dkryfmtahovcjqxClszgnubipwdkryf": return 3;
    case "dkryfmtahovcjqxelszgnubipwdkryfA": return 4;
    case "dkryfmtahovcjqxelszgnubipwdkryfB": return 5;
    case "dkryfmtahovcjqxelszgnubipwdkryfC": return 6;
    case "Akryfmtahovcjqxelszgnubipwdkryfmt": return 7;
    case "Bkryfmtahovcjqxelszgnubipwdkryfmt": return 8;
    case "Ckryfmtahovcjqxelszgnubipwdkryfmt": return 9;
    case "dkryfmtahovcjqxelAzgnubipwdkryfmta": return 10;
    case "dkryfmtahovcjqxelBzgnubipwdkryfmta": return 11;
    case "dkryfmtahovcjqxelCzgnubipwdkryfmta": return 12;
    case "dkryfmtahovcjqxelszgnubipwdkryfmtaA": return 13;
    case "dkryfmtahovcjqxelszgnubipwdkryfmtaB": return 14;
    case "dkryfmtahovcjqxelszgnubipwdkryfmtaC": return 15;
    case "Akryfmtahovcjqxelszgnubipwdkryfmtaho": return 16;
    case "Bkryfmtahovcjqxelszgnubipwdkryfmtaho": return 17;
    case "Ckryfmtahovcjqxelszgnubipwdkryfmtaho": return 18;
    case "dkryfmtahovcjqxelsAgnubipwdkryfmtahov": return 19;
    case "dkryfmtahovcjqxelsBgnubipwdkryfmtahov": return 20;
    case "dkryfmtahovcjqxelsCgnubipwdkryfmtahov": return 21;
    case "dkryfmtahovcjqxelszgnubipwdkryfmtahovA": return 22;
    case "dkryfmtahovcjqxelszgnubipwdkryfmtahovB": return 23;
    case "dkryfmtahovcjqxelszgnubipwdkryfmtahovC": return 24;
    case "Akryfmtahovcjqxelszgnubipwdkryfmtahovcj": return 25;
    case "Bkryfmtahovcjqxelszgnubipwdkryfmtahovcj": return 26;
    case "Ckryfmtahovcjqxelszgnubipwdkryfmtahovcj": return 27;
    case "dkryfmtahovcjqxelszgAubipwdkryfmtahovcjq": return 28;
    case "dkryfmtahovcjqxelszgBubipwdkryfmtahovcjq": return 29;
    case "dkryfmtahovcjqxelszgCubipwdkryfmtahovcjq": return 30;
    default: return 0;
  }
}
const answers: number[] = [];
for (let g = 0; g < texts.length; g++) {
  for (const text of texts[g]) {
    for (const subject of kindsOf(text)) {
      for (const key of keys[g]) {
        for (const room of [32, 128]) {
          classify(headOf(key, room), 1);
          answers.push(classify(subject, 1));
        }
      }
    }
  }
}
console.log(answers.join(","));
