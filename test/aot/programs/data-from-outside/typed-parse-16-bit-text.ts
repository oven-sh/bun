// `JSON.parse(text) as T` on 16-bit strings: string values keep every UTF-16 code unit, and a code unit whose low byte looks like JSON syntax is not syntax.
// IR+ ^ .*JSONStartsWith
declare const aotOperationCount: undefined | ((name: string) => number);
interface Person { name: string; tags: string[]; note: string | null; extra: unknown; counts: Record<string, number> }

const escaped = (text: string): string => text.replace(/[^\x20-\x7e]/g, unit => "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0"));
function attempt(text: string): string {
  try {
    return escaped(JSON.stringify(JSON.parse(text) as Person));
  } catch (error) {
    return (error as Error).constructor.name + " " + escaped((error as Error).message);
  }
}
const person = (name: string, more = ""): string => `{"name":"${name}","tags":["${name}${name}","a"],"note":null,"extra":{"${name}":["${name}"]},"counts":{"${name}":1,"b":2}${more}}`;
const fallbacks = (): number => (typeof aotOperationCount === "function" ? aotOperationCount("operationAOTJSONSourceAbandon") : 0);

const before = fallbacks();
for (const name of [
  "\u00ff", "\u4e2d", "\u00ff", "\u01ff", "\uffff", "\u00fe\u0100", "\u8000\u9fff", "\ud83d\ude00", "\ud83d", "\ude00x", "x\ud83d",
  "\u0122", "\u015c", "\u0100", "\u010a", "\u017d\u017b\u012c\u013a", "\u00e9", "plain", "\u3042".repeat(40), "a".repeat(40) + "\u3042",
]) {
  console.log(attempt(person(name)));
  console.log(attempt(person(name, ',"\u3042":"\u3042"')));
}
console.log("fast path", fallbacks() - before === 0);
console.log(attempt(person("\\n\u3042\\u3042\\\\")));
for (const text of [
  "\u017b" + person("x").slice(1), person("x").slice(0, -1) + "\u017d", person("x").replace('"note":', '"note"\u013a'), person("x").replace("null", "nul\u016c"),
  person("x").replace(',"tags"', '\u012c"tags"'), person("x").replace('"name"', '\u0122name"'), person("x").replace('"name"', '"nam\u0165"'), person("x") + "\u3000", "\ufeff" + person("x"),
  person("\u3042").replace(":1,", ":\u0131,"), person("\u3042\u0001"), person("\u3042").slice(0, 12), "\u3042",
]) console.log(attempt(text));
