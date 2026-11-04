function outer() {
  const order: string[] = [];
  const say = (s: string) => { order.push(s); return s; };
  const a = (three as (...xs: unknown[]) => string)(say("p"));
  const b = (three as (...xs: unknown[]) => string)(say("q"), say("r"), say("s"), say("t"), say("u"));
  const c = counts(1, 2, 3);
  const d = rest(1, 2, 3, 4);
  const e = preset();
  return [a, b, c, d, e, order.join("")].join(" ");
  function three(x?: string, y?: string, z?: string): string { return `${x}-${y}-${z}`; }
  function counts(..._: number[]): number { return arguments.length; }
  function rest(first: number, ...others: number[]): string { return first + ":" + others.join("+"); }
  function preset(x = 5, y = x * 2): number { return x + y; }
}
console.log(outer());
