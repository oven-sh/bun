// The compiled pattern of a literal is made when the literal is first evaluated and lasts as long as the program; nothing but the run time holds it between two evaluations. Here literals are first evaluated a few at a time, with young and full collections between, in every order of the two, and all of them are evaluated again at the end.
const shell = globalThis;
const collectFull = shell.gc ?? (() => Bun.gc(true));
const collectYoung = shell.edenGC ?? require("bun:jsc").edenGC;
const literals = [
  () => /k0-(\d+)(?<tail>[a-c]*)/,
  () => /k1-(\d+)(?<tail>[a-d]*)/g,
  () => /k2-(\d+)(?<tail>[a-e]*)/i,
  () => /k3-(\d+)(?<tail>[a-f]*)/u,
  () => /k4-(\d+)(?<tail>[a-g]*)/y,
  () => /k5-(\d+)(?<tail>[a-h]*)/m,
  () => /k6-(\d+)(?<tail>[a-c]*)/s,
  () => /k7-(\d+)(?<tail>[a-d]*)/gi,
  () => /k8-(\d+)(?<tail>[a-e]*)/d,
  () => /k9-(\d+)(?<tail>[a-f]*)/v,
  () => /k10-(\d+)(?<tail>[a-g]*)/,
  () => /k11-(\d+)(?<tail>[a-h]*)/g,
  () => /k12-(\d+)(?<tail>[a-c]*)/i,
  () => /k13-(\d+)(?<tail>[a-d]*)/u,
  () => /k14-(\d+)(?<tail>[a-e]*)/y,
  () => /k15-(\d+)(?<tail>[a-f]*)/m,
  () => /k16-(\d+)(?<tail>[a-g]*)/s,
  () => /k17-(\d+)(?<tail>[a-h]*)/gi,
  () => /k18-(\d+)(?<tail>[a-c]*)/d,
  () => /k19-(\d+)(?<tail>[a-d]*)/v,
  () => /k20-(\d+)(?<tail>[a-e]*)/,
  () => /k21-(\d+)(?<tail>[a-f]*)/g,
  () => /k22-(\d+)(?<tail>[a-g]*)/i,
  () => /k23-(\d+)(?<tail>[a-h]*)/u,
  () => /k24-(\d+)(?<tail>[a-c]*)/y,
  () => /k25-(\d+)(?<tail>[a-d]*)/m,
  () => /k26-(\d+)(?<tail>[a-e]*)/s,
  () => /k27-(\d+)(?<tail>[a-f]*)/gi,
  () => /k28-(\d+)(?<tail>[a-g]*)/d,
  () => /k29-(\d+)(?<tail>[a-h]*)/v,
  () => /k30-(\d+)(?<tail>[a-c]*)/,
  () => /k31-(\d+)(?<tail>[a-d]*)/g,
  () => /k32-(\d+)(?<tail>[a-e]*)/i,
  () => /k33-(\d+)(?<tail>[a-f]*)/u,
  () => /k34-(\d+)(?<tail>[a-g]*)/y,
  () => /k35-(\d+)(?<tail>[a-h]*)/m,
  () => /k36-(\d+)(?<tail>[a-c]*)/s,
  () => /k37-(\d+)(?<tail>[a-d]*)/gi,
  () => /k38-(\d+)(?<tail>[a-e]*)/d,
  () => /k39-(\d+)(?<tail>[a-f]*)/v,
  () => /k40-(\d+)(?<tail>[a-g]*)/,
  () => /k41-(\d+)(?<tail>[a-h]*)/g,
  () => /k42-(\d+)(?<tail>[a-c]*)/i,
  () => /k43-(\d+)(?<tail>[a-d]*)/u,
  () => /k44-(\d+)(?<tail>[a-e]*)/y,
  () => /k45-(\d+)(?<tail>[a-f]*)/m,
  () => /k46-(\d+)(?<tail>[a-g]*)/s,
  () => /k47-(\d+)(?<tail>[a-h]*)/gi,
  () => /k48-(\d+)(?<tail>[a-c]*)/d,
  () => /k49-(\d+)(?<tail>[a-d]*)/v,
  () => /k50-(\d+)(?<tail>[a-e]*)/,
  () => /k51-(\d+)(?<tail>[a-f]*)/g,
  () => /k52-(\d+)(?<tail>[a-g]*)/i,
  () => /k53-(\d+)(?<tail>[a-h]*)/u,
  () => /k54-(\d+)(?<tail>[a-c]*)/y,
  () => /k55-(\d+)(?<tail>[a-d]*)/m,
  () => /k56-(\d+)(?<tail>[a-e]*)/s,
  () => /k57-(\d+)(?<tail>[a-f]*)/gi,
  () => /k58-(\d+)(?<tail>[a-g]*)/d,
  () => /k59-(\d+)(?<tail>[a-h]*)/v,
];
function garbage(count) {
  let kept = null;
  for (let i = 0; i < count; i++) kept = { i, text: "t" + i, list: [i, kept && kept.i] };
  return kept.i;
}
function ask(index) {
  const pattern = literals[index]();
  const match = pattern.exec("xx k" + index + "-" + index * 7 + "abcz K" + index + "-1");
  return index + ":" + pattern.flags + ":" + (match ? match[0] + "|" + match.groups.tail + "|" + match.index : "none") + ":" + pattern.source.length;
}
const between = [collectYoung, collectFull, () => { collectYoung(); collectYoung(); }, () => { collectFull(); collectYoung(); }, () => { collectYoung(); collectFull(); }, () => garbage(20000)];
const first = [];
for (let index = 0; index < literals.length; index++) {
  first.push(ask(index));
  if (index % 3 === 2) {
    garbage(3000);
    between[(index / 3 | 0) % between.length]();
  }
}
collectFull();
garbage(50000);
collectYoung();
let same = 0;
for (let round = 0; round < 3; round++) {
  for (let index = literals.length - 1; index >= 0; index--) same += ask(index) === first[index] ? 1 : 0;
  between[round]();
}
console.log(first.join("\n"));
console.log("the same at the end:", same, "of", 3 * literals.length);
