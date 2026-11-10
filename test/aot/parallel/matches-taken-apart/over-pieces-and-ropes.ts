// The subject is a piece that was never cut out, a text joined of two, or one of wide units; the RegExp takes its object along (g, y) or not; the result is only taken apart, read behind a meeting of ways, or gets out. What is printed is what plain Bun prints.
// STATISTIC: RegExpMatchAllocationsElided >= 7
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
const kept: any[] = [];
const whole: string = unseen("xx color=red yy size=big zz k=中文 end");
function describe(m: any): string {
  return m === null ? "null" : JSON.stringify(m) + m.index + "/" + m.input + "/" + m.length;
}
function plain(text: string, keep: boolean, other: boolean): string {
  const m = /([a-z]+)=(\S*)/.exec(text);
  if (!m) return "none";
  if (keep) kept.push(m);
  let between = "";
  if (other) between = "o"; else between = "n";
  return m[1] + between + m[2] + m.index;
}
function global(text: string, keep: boolean, other: boolean): string {
  const m = /([a-z]+)=(\S*)/g.exec(text);
  if (!m) return "none";
  if (keep) kept.push(m);
  let between = "";
  if (other) between = "o"; else between = "n";
  return m[1] + between + m[2] + m.index;
}
function sticky(text: string, keep: boolean): string {
  const m = /([a-z]+)=(\S*)/y.exec(text);
  if (!m) return "none";
  if (keep) kept.push(m);
  return m[1] + "," + m[2] + m.index;
}
function byMatch(text: string, keep: boolean): string {
  const m = text.match(/([a-z]+)=(\S*)/y);
  if (m === null) return "none";
  if (keep) kept.push(m);
  return m[1] + "," + m[2] + m.index;
}
function behindAMeeting(text: string, other: boolean): string {
  const m = /([a-z]+)=(\S*)/g.exec(text);
  if (!m) return "none";
  let between = "";
  if (other) between = "o"; else between = "n";
  return m[1] + between + m[2] + m.index + m.input.length;
}
function stickyApart(text: string): string {
  const m = /([a-z]+)=(\S*)/y.exec(text);
  if (m === null) return "none";
  return m[0] + "," + m[1] + "," + m[2] + m.index;
}
function returned(text: string): RegExpExecArray | null {
  const m = /([a-z]+)=(\S*)/g.exec(text);
  if (m) told.push(m[1]!);
  return m;
}
for (const keep of unseen([false, true]))
  for (const [from, to] of unseen([[3, 12], [16, 24], [0, 2], [28, 31], [3, 40], [5, 5]])) {
    const other: boolean = unseen(from > 4);
    told.push(plain(whole.slice(from, to), keep, other), global(whole.slice(from, to), keep, other), sticky(whole.slice(from, to), keep), byMatch(whole.substring(from, to), keep));
    told.push(plain(whole.slice(from, to) + unseen(" a=b"), keep, other), global(unseen("q=") + whole.slice(from, to), keep, other), sticky(whole.slice(from, to).slice(1), keep));
    told.push(behindAMeeting(whole.slice(from, to), other), behindAMeeting(whole.slice(from, to) + unseen(" z=9"), other), stickyApart(whole.slice(from, to)), stickyApart(whole.slice(from, to).slice(1)), stickyApart(unseen("w=") + whole.slice(from, to)));
    told.push(describe(returned(whole.slice(from, to))), describe(returned(whole.slice(from, to).slice(2) + whole.slice(0, 2))));
  }
for (const m of kept) told.push(describe(m));
console.log(told.join("\n"));
