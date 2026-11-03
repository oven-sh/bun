// `JSON.parse(text) as T` scans a copy of its input that is followed by 64 zero bytes, without bounds checks. The copy's capacity is a power of two.
// Every input here is a power of two minus 64 characters long, so the zero bytes end where the allocation ends, and a read past them is out of bounds under a sanitizer or a guarded allocator.
// Each input is parsed as an 8-bit and as a 16-bit string.
interface Flat { id: number; name: string; ok: boolean }
interface Long { k234567890123456789012345678901234567890123456789012345678901234: number; k2345678901234567890123456789012345678901234567890123456789012345: number; k23456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789: string; k234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890: boolean }
interface Prefixes { a: number; ab: number; abcdefgh: number; abcdefghi: number; abcdefgh_1: number; abcdefghijklmnop: number; abcdefghijklmnopq: number }
type Union = { kind: "a"; v: number } | { kind: "b"; v: string } | { kind: "a_very_long_discriminant_that_goes_on_for_more_than_sixty_four_bytes_of_text"; w: boolean };
interface Nested { m: number[][]; t: [number, string, boolean]; o: { p: { q: number } } }
type Dictionary = Record<string, number>;
interface Text { s: string }
interface Num { n: number }
interface Lit { s: "a_literal_that_goes_on_for_more_than_sixty_four_bytes_of_text_and_then_some_more" | "b"; n: 123456789012345 | 1 }
let state = 2166136261, count = 0, accepted = 0;
const note = (text: string): void => { for (let i = 0; i < text.length; i++) state = Math.imul(state ^ text.charCodeAt(i), 16777619) >>> 0; };
function parseOnce(parse: (text: string) => unknown, text: string): void { count++; try { note(JSON.stringify(parse(text)) ?? "undefined"); accepted++; } catch (error) { note((error as Error).constructor.name); } }
function one(parse: (text: string) => unknown, text: string): void {
  parseOnce(parse, text);
  parseOnce(parse, ("\u0100" + text).slice(1));
}
const parsers: [(text: string) => unknown, string[]][] = [
  [text => JSON.parse(text) as Flat, ['{"id":1,"name":"ab","ok":true}', '{"ok":false,"zz":[1,{"a":"b"}],"name":"\\u00e9\\n","id":-1.5e2}']],
  [text => JSON.parse(text) as Long, ['{"k234567890123456789012345678901234567890123456789012345678901234":1,"k2345678901234567890123456789012345678901234567890123456789012345":2,"k23456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789":"z","k234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890":true}']],
  [text => JSON.parse(text) as Prefixes, ['{"a":1,"ab":2,"abcdefgh":5,"abcdefghi":6,"abcdefgh_1":7,"abcdefghijklmnop":9,"abcdefghijklmnopq":10}']],
  [text => JSON.parse(text) as Union, ['{"kind":"a","v":1}', '{"kind":"a_very_long_discriminant_that_goes_on_for_more_than_sixty_four_bytes_of_text","w":true}', '{"v":"s","kind":"b"}']],
  [text => JSON.parse(text) as Nested, ['{"m":[[1,2],[],[3]],"t":[1,"s",true],"o":{"p":{"q":1}}}']],
  [text => JSON.parse(text) as Dictionary, ['{"a":1,"10":2,"' + "q".repeat(90) + '":3}']],
  [text => JSON.parse(text) as Text, ['{"s":"' + "a".repeat(100) + '"}', '{"s":"' + "a".repeat(30) + "\\n" + "b".repeat(40) + "\\u00e9" + '"}']],
  [text => JSON.parse(text) as Num, ['{"n":123456789012345678901234567890.123456789012345678901234567890e-10}', '{"n":-0.000000000000000000000000000000000000000000000000000000000000000000000000001}', '{"n":1e308}']],
  [text => JSON.parse(text) as Lit, ['{"s":"a_literal_that_goes_on_for_more_than_sixty_four_bytes_of_text_and_then_some_more","n":123456789012345}', '{"s":"b","n":1}']],
];
for (let bits = 6; bits <= 14; bits++) {
  const length = (1 << bits) - 64;
  if (length <= 0) continue;
  for (const [parse, texts] of parsers) for (const text of texts) for (let cut = 0; cut <= text.length; cut++) {
    const part = text.slice(0, cut);
    if (part.length > length) continue;
    one(parse, " ".repeat(length - part.length) + part);
    if (part.length + 12 <= length && part.startsWith("{") && part.length > 1) one(parse, '{"zzz":"' + "x".repeat(length - part.length - 9) + '",' + part.slice(1));
  }
  console.log("texts of " + length + " bytes: " + count + " so far, " + accepted + " accepted, " + state.toString(16));
}
