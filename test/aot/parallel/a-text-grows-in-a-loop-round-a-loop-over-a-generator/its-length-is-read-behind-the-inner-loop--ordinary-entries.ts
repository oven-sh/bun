function* entries(map: Map<string, number>) { for (const [k, v] of map) yield `${k}=${v}`; }
function report(maps: Map<string, number>[]): string {
  let out = "";
  for (const map of maps) { let n = 0; for (const line of entries(map)) n += line.length; if (out.length) out += ", "; out += n > 3 ? "long" : "short"; }
  return out;
}
console.log(report([new Map([["a", 1]]), new Map([["bcd", 22]])]));
