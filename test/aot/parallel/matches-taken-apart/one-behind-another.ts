// One buffer holds where the last match lay. Matches stand inside one another, beside one another, in callees, in getters and across suspensions; each is read behind the others. What is printed is what plain Bun prints.
// STATISTIC: RegExpMatchAllocationsElided >= 10
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
function inner(text: string): string {
  const m = /(\d)(\d)?/.exec(text);
  return m ? m[1] + String(m[2]) : "no digits";
}
function nested(a: string, b: string): string {
  const first = /^([a-z]+)=(.*)$/.exec(a);
  if (!first) return "none";
  const second = /^([a-z]+):(.*)$/.exec(b);
  if (!second) return first[1] + "," + first[2] + "," + first.index;
  return first[1] + "," + first[2] + "," + second[1] + "," + second[2] + "," + first.index + second.index;
}
function withCallBetween(a: string, b: string): string {
  const m = /^([a-z]+)=(.*)$/.exec(a);
  if (!m) return "none";
  const between = inner(b);
  return m[1] + "," + between + "," + m[2];
}
function keptWithCallBetween(a: string, b: string, keep: any[]): string {
  const m = /^([a-z]+)=(.*)$/.exec(a);
  if (!m) return "none";
  const between = inner(b);
  keep.push(m);
  return m[1] + "," + between + "," + m[2];
}
function matchOfAGroup(a: string): string {
  const m = /^([a-z]+)=(.*)$/.exec(a);
  if (!m) return "none";
  const again = /^(.)(.*)$/.exec(m[2]!);
  if (!again) return m[1] + ", nothing";
  return m[1] + "," + m[2] + "," + again[1] + "," + again[2];
}
function inALoop(lines: string[]): string {
  let out = "";
  let last: string | undefined;
  for (const line of lines) {
    const m = /^([a-z]+)=(.*)$/.exec(line);
    if (m) {
      out += m[1] + (last ?? "-") + inner(m[2]!);
      last = m[2];
    }
  }
  return out;
}
async function acrossAnAwait(a: string, b: string): Promise<string> {
  const m = /^([a-z]+)=(.*)$/.exec(a);
  if (!m) return "none";
  await null;
  const other = inner(b);
  await null;
  return m[1] + "," + other + "," + m[2] + "," + m.index;
}
function* acrossAYield(a: string): Generator<string, string, string> {
  const m = /^([a-z]+)=(.*)$/.exec(a);
  if (!m) return "none";
  const sent = yield m[1]!;
  return inner(sent) + m[2];
}
function replacedBetween(a: string): string {
  const m = /^([a-z]+)=(.*)$/.exec(a);
  if (!m) return "none";
  const replaced = a.replace(/([a-z])/g, (_, letter) => letter.toUpperCase());
  const parts = a.split(/=/);
  return m[1] + "," + replaced + "," + parts.length + "," + m[2] + /e/.test(a);
}
function subjectWithToString(a: { toString(): string }): string {
  const m = /^([a-z]+)=(.*)$/.exec(String(a));
  if (!m) return "none";
  return m[1] + "," + m[2];
}
const kept: any[] = [];
for (const a of unseen(["color=red", "plain", "n=42"]))
  for (const b of unseen(["size:7", "x=12", ""])) {
    told.push(nested(a, b), withCallBetween(a, b), keptWithCallBetween(a, b, kept), matchOfAGroup(a), replacedBetween(a));
    told.push(subjectWithToString({ toString() { inner(b); return a; } }));
    const steps = acrossAYield(a);
    const step = steps.next();
    told.push(String(step.value) + (step.done ? "" : steps.next(b).value));
  }
told.push(inALoop(unseen(["a=1", "b", "c=23", "d=x"])));
for (const m of kept) told.push(JSON.stringify(m) + m.index + m.input);
const waited = await Promise.all([acrossAnAwait(unseen("k=v"), unseen("1")), acrossAnAwait(unseen("q=w9"), unseen("23")), acrossAnAwait(unseen("none"), unseen("4"))]);
console.log(told.concat(waited).join("\n"));
