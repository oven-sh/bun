// push, pop, shift, unshift, splice, reverse, fill, copyWithin and sort of Array.prototype are called on a typed record that has a length.
type Like = { length: number; tag: string };
function like(n: number): Like { return { length: n, tag: "t" + n }; }
function size(l: Like): number { return l.length + 1; }
const A = Array.prototype as any;
const out: string[] = [];
for (let i = 0; i < 3; i++) {
  const l = like(i);
  out.push("push " + A.push.call(l, "x", "y") + " " + size(l) + " " + JSON.stringify(l));
  out.push("pop " + A.pop.call(l) + " " + size(l) + " " + JSON.stringify(l));
  out.push("unshift " + A.unshift.call(l, 7) + " " + size(l) + " " + JSON.stringify(l));
  out.push("shift " + A.shift.call(l) + " " + size(l) + " " + JSON.stringify(l));
  A.splice.call(l, 0, 1, "p", "q", "r"); out.push("splice " + size(l) + " " + JSON.stringify(l) + " " + Object.keys(l).join());
  A.reverse.call(l); A.fill.call(l, 0, 1, 2); A.copyWithin.call(l, 0, 1); A.sort.call(l);
  out.push("more " + size(l) + " " + JSON.stringify(l));
  (l as any).length = "3"; out.push("text " + typeof l.length + " " + size(l) + " " + A.join.call(l, "-"));
}
console.log(out.join("\n"));
