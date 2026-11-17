const heads = ["alpha", "gamma", "delta", "omega", "sigma"];
const tails = ["north", "south", "eastt", "westt", "upper"];
const line = heads.map((head, i) => "x" + head + tails[i] + "y").join("|");
const makers: Record<string, (i: number) => string> = {
  sum: i => heads[i % 5]! + tails[Math.trunc(i / 5) % 5]!,
  three: i => heads[i % 5]! + "-" + tails[Math.trunc(i / 5) % 5]!,
  piece: i => line.slice(1 + (i % 5) * 13, 11 + (i % 5) * 13),
  pieces: i => line.slice(1 + (i % 5) * 13, 6 + (i % 5) * 13) + line.slice(6 + (Math.trunc(i / 5) % 5) * 13, 11 + (Math.trunc(i / 5) % 5) * 13),
  wide: i => heads[i % 5]! + "☃" + tails[Math.trunc(i / 5) % 5]!,
  widePiece: i => ("<" + heads[i % 5]! + "☃" + tails[i % 5]! + ">").slice(1, 12),
  deep: i => {
    let text = "";
    for (const c of heads[i % 5]!) text += c;
    for (const c of tails[Math.trunc(i / 5) % 5]!) text += c;
    return text;
  },
  short: i => heads[i % 5]![0]! + tails[Math.trunc(i / 5) % 5]![1]!,
  long: i => heads[i % 5]! + "-".repeat(70) + tails[Math.trunc(i / 5) % 5]!,
  empty: i => heads[i % 5]!.slice(5) + tails[i % 5]!.slice(5),
};

function byIfs(t: string): number {
  if (t === "alphanorth") return 1;
  if (t === "gammasouth") return 2;
  if (t === "delta-eastt") return 3;
  if (t === "omega☃westt") return 4;
  if (t === "su") return 5;
  if (t === "ao") return 6;
  if (t === "alpha----------------------------------------------------------------------north") return 7;
  if (t === "") return 8;
  return 0;
}

function bySwitch(t: string): number {
  switch (t) {
    case "alphanorth": return 1;
    case "gammasouth": return 2;
    case "deltaeastt": return 3;
    case "sigma-upper": return 4;
    case "sigma☃upper": return 5;
    case "go": return 6;
    case "ow": return 7;
    case "gammawestt": return 8;
    default: return 0;
  }
}

function byChoice(t: string): number {
  return t === "omegawestt" || t === "omegaupper" || t === "gamma☃south" || t != "alphanorth" ? (t === "sigmanorth" ? 2 : 1) : 0;
}

for (const name of Object.keys(makers)) {
  const make = makers[name]!;
  const kept: string[] = [];
  for (let i = 0; i < 25; i++) kept.push(make(i));
  let sum = 0;
  for (let turn = 0; turn < 4; turn++) {
    for (let i = 0; i < kept.length; i++) sum = (sum * 31 + byIfs(kept[i]!) * 100 + bySwitch(kept[i]!) * 10 + byChoice(kept[i]!)) % 1000003;
    for (let i = 0; i < 25; i++) sum = (sum * 37 + byIfs(make(i)) * 100 + bySwitch(make(i)) * 10 + byChoice(make(i))) % 1000003;
    for (let i = 0; i < kept.length; i += 3) kept[i] = turn % 2 ? kept[i]!.slice(0, -1) : kept[i]! + "!";
  }
  const asKeys: Record<string, number> = {};
  for (const text of kept) asKeys[text] = (asKeys[text] ?? 0) + 1;
  console.log(name, sum, Object.keys(asKeys).join(","), kept.map(t => t.length + t.charCodeAt(0)).join(" "));
}
