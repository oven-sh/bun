// An object literal in text that becomes code at run time spells members of a declared type that the program itself never stores or reads, and a member of a union of texts that it never makes.
interface Settings { stored: number; neverStored?: string; neverStoredMode?: "one" | "two" }
function describe(s: Settings): string { return s.stored % 8 + " " + Object.keys(s).join() + " " + JSON.stringify(s).length; }
const text = process.env.OTHER_TEXT ?? `
  switch (i % 5) {
  case 0: return describe({ stored: i });
  case 1: return describe({ stored: i, neverStored: "x" });
  case 2: return describe({ neverStoredMode: "two", stored: i, neverStored: "y" });
  case 3: return describe({ stored: i, neverStoredMode: "three" });
  default: given.neverStored = "z"; given.stored = i; return describe(given) + " " + given.neverStored + ("neverStoredMode" in given);
  }`;
const made = new Function("describe", "given", "i", text) as (d: typeof describe, given: Settings, i: number) => string;
const given: Settings = { stored: -1 };
const counts = new Map<string, number>();
for (let i = 0; i < 2000; i++) {
  const said = made(describe, given, i);
  counts.set(said, (counts.get(said) ?? 0) + 1);
}
console.log([...counts].sort().map(([said, count]) => count + " x " + said).join("\n"));
console.log(Object.keys(given).join(), JSON.stringify(given));
