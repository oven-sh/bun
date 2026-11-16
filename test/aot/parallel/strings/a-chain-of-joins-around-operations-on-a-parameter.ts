const log: string[] = [];
const seen = new Map<string, number>();
for (let i = 0; i < 64; i++) seen.set("r" + (i & 7) + "c" + ((i >> 3) & 7) + ":" + i, i);
const table: Record<string, number> = {};
for (let i = 0; i < 64; i++) table["k" + i + "_" + (i & 7)] = i;

const readers: Record<string, (i: number) => unknown> = {
  keyOfMap: (i) => seen.get("r" + (i & 7) + "c" + ((i >> 3) & 7) + ":" + (i & 63)),
  nameOfProperty: (i) => table["k" + (i & 63) + "_" + (i & 7)],
  kept: (i) => "r" + (i & 7) + "c" + ((i >> 3) & 7) + ":" + (i & 63),
  length: (i) => ("r" + (i & 7) + "c" + ((i >> 3) & 7) + ":" + (i & 63)).length,
  compared: (i) => "r" + (i & 7) + "c" + ((i >> 3) & 7) + ":" + (i & 63) === "r1c1:9",
  readTwice: (i) => { const text = "a" + (i & 3) + "b" + (i & 12); return text + "|" + seen.has(text) + "|" + text.length; },
  endsInText: (i) => "<" + (i & 7) + "," + (i | 1) + ">" + "!",
  endsInParameter: (i) => "<" + (i & 7) + "," + (i | 1) + ">" + i,
  sumInFront: (i) => (i & 7) + (i & 3) + ":" + (i & 1) + ";",
  template: (i) => `r${i & 7}c${(i >> 3) & 7}:${i & 63}` + (i & 1),
};

function counted(name: string, value: number) {
  return { valueOf() { log.push(name); return value; } } as unknown as number;
}

const handed: (() => number)[] = [
  () => 9, () => 9, () => 73, () => -1, () => 2 ** 31, () => 1.75, () => NaN, () => -0,
  () => counted("first", 9), () => 9, () => counted("second", 73),
  () => "9" as unknown as number, () => null as unknown as number, () => undefined as unknown as number, () => true as unknown as number,
  () => 9n as unknown as number, () => Symbol("s") as unknown as number, () => [9] as unknown as number, () => 9,
];

for (const name of Object.keys(readers)) {
  for (const make of handed) {
    let said: string;
    try {
      said = String(readers[name]!(make()));
    } catch (error) {
      said = (error as Error).name;
    }
    console.log(name, said, log.splice(0).join());
  }
}
