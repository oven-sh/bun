// Written texts of one length lie beside names, keys, parsed, joined, cut and wide texts of the same characters.
const tails = ["ha", "ma", "ta", "ga", "pa"];
const names = { alpha: 1, gamma: 2, delta: 3, omega: 4, kappa: 5 };
const written: string[] = ["alpha", "gamma", "delta", "omega", "kappa", "sigma", "theta", "lambd", "alph\u{e9}", "☃☃lph", "al", "a", ""];
const wide = "☃alpha☃gamma☃sigma☃theta";
function others(): string[] {
  const made: string[] = [];
  made.push(...Object.keys(names), ...written.map(text => text.split("").join("")), ...written.map(text => JSON.parse(JSON.stringify(text)) as string));
  made.push("alp" + tails[0]!, "gam" + tails[1]!, `del${tails[2]!}`, "ome".concat(tails[3]!), ["kap", tails[4]!].join(""));
  made.push(wide.slice(1, 6), wide.slice(7, 12), wide.slice(13, 18), wide.slice(19), "ALPHA".toLowerCase(), "xsigma".replace("x", ""), "alpha,theta".split(",")[1]!);
  made.push(String.fromCharCode(97), "alpha"[0]!, "alpha".slice(0, 2), "alpha".repeat(1), ...Object.keys({ ["sig" + tails[1]!]: 1, theta: 2 }), (function kappa() {}).name, Symbol("omega").description!);
  return made;
}
function same(left: string, right: string): boolean {
  return left === right;
}
function loosely(left: unknown, right: unknown): boolean {
  return left == right;
}
function place(list: readonly string[], text: string): number {
  for (let at = 0; at < list.length; at++) if (list[at] === text) return at;
  return -1;
}
function last(list: readonly string[], text: string): number {
  for (let at = list.length - 1; at >= 0; at--) if (!(list[at] !== text)) return at;
  return -1;
}
function maybe(text: string | undefined, other: string | null): boolean {
  return text === (other as unknown);
}
function kind(text: string): number {
  switch (text) {
    case written[0]: return 0;
    case written[1]: return 1;
    case written[5]: return 5;
    case written[8]: return 8;
    default: return -1;
  }
}
const mixed: unknown[] = [1, undefined, "gamma", null, "sigma", {}, "alp" + tails[0]!, "theta", Object.keys(names)[3], "kappa"];
for (let turn = 0; turn < 3; turn++) {
  const made = others();
  const all = [...written, ...made];
  const rows: string[] = [];
  for (const text of all) {
    let equal = 0;
    let loose = 0;
    let nullable = 0;
    for (const other of all) {
      if (same(text, other)) equal++;
      if (loosely(text, other)) loose++;
      if (maybe(text, other)) nullable++;
    }
    rows.push([equal, loose, nullable, place(written, text), last(all, text), kind(text), written.indexOf(text), written.lastIndexOf(text), written.includes(text) ? 1 : 0, all.indexOf(text, 3), made.indexOf(text), mixed.indexOf(text), mixed.includes(text) ? 1 : 0].join(","));
  }
  console.log(turn, rows.join(" "));
  console.log(written.map(text => [same(text, written[0]!), written.findIndex(other => other === text), written.filter(other => other !== text).length].join()).join(" "));
  console.log(new Set(all).size, new Map(all.map(text => [text, text.length])).size, all.toSorted().filter((text, at, list) => at === 0 || text !== list[at - 1]).length);
}
