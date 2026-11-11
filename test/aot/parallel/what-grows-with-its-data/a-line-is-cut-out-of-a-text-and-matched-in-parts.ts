// Each line of a long text is cut out and matched, and the groups are read: no match may run beyond the line, found or not.
// Sizes: 1000 4000 16000
// Passes: 150
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const line = "alpha=beta gamma\n";
const held = /^([a-z]+)=([a-z]+)/;
function written(text: string, from: number, to: number): number {
  const m = /^([a-z]+)=([a-z]+)/.exec(text.slice(from, to));
  return m ? m[1]!.length + m[2]!.length : 0;
}
function kept(text: string, from: number, to: number): number {
  const m = held.exec(text.slice(from, to));
  return m ? m[2]!.length : 0;
}
function missing(text: string, from: number, to: number): number {
  const m = /([0-9]+);/.exec(text.slice(from, to));
  return m ? m[1]!.length : 1;
}
function once(): string {
  const whole: string = JSON.parse(JSON.stringify(line.repeat(size)));
  let at = 0,
    seen = 0;
  while (at < whole.length) {
    const end = whole.indexOf("\n", at);
    seen += written(whole, at, end) + kept(whole, at, end) + missing(whole, at, end);
    at = end + 1;
  }
  return [seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
