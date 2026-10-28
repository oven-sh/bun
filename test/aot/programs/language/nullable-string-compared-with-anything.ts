// `value === text`, text a parameter annotated `string` (which may yet be undefined or null) and nothing known of value: if value is a string the two are compared in line; if it is none, they are equal only as the same undefined or null.
// CALLS- lookup StrictEqual
// CALLS- differs StrictEqual
// CALLS+ ofAnything StrictEqual
function lookup(head: any, key: string): unknown {
  for (let entry = head; entry; entry = entry.parent) {
    if (entry.key === key) return entry.value;
  }
  return "none";
}
function differs(values: any[], text: string): string {
  let out = "";
  for (let i = 0; i < values.length; i++) out += text !== values[i] ? "1" : "0";
  return out;
}
function ofAnything(values: any[], other: any): string {
  let out = "";
  for (let i = 0; i < values.length; i++) out += values[i] === other ? "1" : "0";
  return out;
}
function made(...parts: string[]): string {
  return parts.join("");
}
let head: any = undefined;
const keys: unknown[] = ["a", made("b", "c"), "", made("long/", "enough/", "to/", "be/", "compared/", "by/", "words"), "été", "世界", 7, 0, NaN, true, null, undefined, 10n, Symbol.for("s"), new String("a"), { toString() { return "a"; } }, ["a"]];
keys.forEach((key, index) => { head = { key, value: index, parent: head }; });
const asked: unknown[] = ["a", made("a"), "bc", made("b") + made("c"), "", made(), made("long/enough/to/be/compared/by/", "words"), made("long/enough/to/be/compared/by/", "wordz"), made("long/enough/to/be/compared/by/", "word"), made("é", "té"), made("世", "界"), made("世", "畍"), "7", "0", "NaN", "true", "null", "undefined", "10", "s", "absent"];
for (const key of asked) console.log(JSON.stringify(key), lookup(head, key as string));
console.log("undefined", lookup(head, undefined as any), "null", lookup(head, null as any));
console.log(differs(keys as any[], "a"), differs(keys as any[], made("b", "c")), differs(keys as any[], ""), differs(keys as any[], undefined as any), differs(keys as any[], null as any));
console.log(ofAnything(keys as any[], "a"), ofAnything(keys as any[], 7), ofAnything(keys as any[], undefined), ofAnything(keys as any[], NaN));
let found = 0;
for (let i = 0; i < 3000; i++) found += lookup(head, i & 1 ? made("b", "c") : made("long/enough/to/be/compared/by/", "words")) as number;
console.log(found);
