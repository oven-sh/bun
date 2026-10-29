// The program tests a property for a kind that its declared type rules out. The operand of `typeof` is a typed read like any other: a string where `string[] | true` is written throws a TypeError at the read, so the branch is never entered.
interface Meta { sign: string[] | true; secrets?: string }
const own: Meta = { sign: ["own"] };
function normalize(meta: Meta): string {
  if (typeof meta.sign === "string") meta.sign = [meta.sign];
  return JSON.stringify(meta);
}
const mistyped = { sign: "one" } as unknown as Meta;
try { console.log(normalize(own), normalize(mistyped)); } catch (e) { console.log("a string:", (e as Error).constructor.name); }
