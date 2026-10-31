// The program tests a property for a kind that its declared type rules out. The operand of `typeof` is a typed read like any other: a string where `string[] | true` is written throws a TypeError at the read, so the branch is never entered.
interface Meta { sign: string[] | true; secrets?: string }
const own: Meta = { sign: ["own"] };
function normalize(app: any): string {
  const meta: Meta = app.cookie;
  if (typeof meta.sign === "string") meta.sign = [meta.sign];
  return JSON.stringify(meta);
}
console.log(normalize({ cookie: own }));
try { console.log(normalize({ cookie: { sign: "one" } })); } catch (e) { console.log("a string:", (e as Error).constructor.name); }
console.log(normalize({ cookie: { sign: ["a"] } }));
try { console.log(normalize(JSON.parse('{"cookie":{"sign":"two","secrets":"s"}}'))); } catch (e) { console.log("a parsed string:", (e as Error).constructor.name); }
