const names = ["a", "b", "id", "line", "lineNumber", "lineNumbers", "column", "columnNumber", "columnNumbers", "startTime", "startTimestamp", "expressionLocation", "expressionLocations", "a name of thirty-two characters", "a name of thirty-two character2", "a name of more than thirty-two characters", "café", "cafè", "中文", "quo\"te", "back\\slash", "}", "a]b", "0", "7", "__proto__", "constructor", "", "x:y"];
const strings = ["", "x", "y", "ab", "seven77", "eight888", "sixteen letters!", "sixteen letters?", "seventeen letters", "https://example.com/a/rather/long/path/of/characters/one.js", "https://example.com/a/rather/long/path/of/characters/two.js", "é", "中", "new\nline", "quo\"te", "}", "]", "z".repeat(256), "z".repeat(257), "0123456789abcdef".repeat(30)];
let state = 12345;
const random = (limit: number): number => (state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) % limit;
const show = (value: any): string => {
  if (value === null || typeof value !== "object") return typeof value + ":" + String(value);
  if (Array.isArray(value)) return "[" + value.map(show).join() + "]";
  return "{" + Object.keys(value).map(key => key + "=" + show(value[key])).join() + (Object.getPrototypeOf(value) === Object.prototype ? "}" : "!}");
};
let hash = 0;
const note = (text: string): void => {
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
};
const value = (depth: number): string => {
  switch (random(depth > 2 ? 4 : 7)) {
    case 0: return String(random(random(3) ? 100 : 1000000));
    case 1: return ["true", "false", "null", "-5", "2.5", "27.140685268008383"][random(6)]!;
    case 2: case 3: return JSON.stringify(strings[random(strings.length)]);
    case 4: return "[" + Array.from({ length: random(4) }, () => value(depth + 1)).join() + "]";
    default: return object(depth + 1);
  }
};
const shapes = Array.from({ length: 12 }, () => Array.from({ length: 1 + random(7) }, () => names[random(names.length)]!));
const object = (depth: number): string => {
  const shape = shapes[random(shapes.length)]!;
  return "{" + shape.slice(0, random(6) ? shape.length : random(shape.length + 1)).map(name => JSON.stringify(random(20) ? name : names[random(names.length)]) + ":" + value(depth)).join() + "}";
};
const ASCII = (text: string): string => text.replace(/[^\x00-\x7e]/g, "~");
for (let round = 0; round < 40; round++) {
  const text = "[" + Array.from({ length: 12 }, () => object(0)).join() + "]";
  for (const each of [text, ASCII(text), ASCII(text), JSON.stringify(JSON.parse(text), null, 2)]) note(show(JSON.parse(each)));
  if (round % 8 === 7) Bun.gc(true);
  if (round % 5 === 4) console.log(round, hash);
}
// More names than are kept, beside an object whose names come again.
for (let i = 0; i < 3000; i++) note(show(JSON.parse(`{"first":${i},"name ${i}":{"second":"string ${i}","of":"a string that comes again"},"last":[${i}]}`)));
console.log(hash);
// More members than lie in a cell, and each name twice.
const many = (n: number): string => "{" + Array.from({ length: n }, (_, i) => `"member${i}":${i}`).join() + "}";
for (const n of [5, 6, 7, 63, 64, 65, 66, 200]) console.log(n, Object.keys(JSON.parse(many(n))).length, show(JSON.parse(`[${many(n)},${many(n)}]`)).length, show(JSON.parse(`{"twice":1,${many(n).slice(1, -1)},"twice":2,"member0":3}`)).length);
// The bytes of a wide text stand for other characters than those of a narrow one.
const wide = (text: string): string => text.replace("w", "中");
for (const letter of ["ÿ", "þ", "é", "￿", "ǿ"]) {
  const text = `[{"${letter}a":"${letter}","w":1},{"${letter}a":"${letter}","w":2},{"${letter}b":"${letter}${letter}","w":3}]`;
  for (const each of [text, wide(text), text, wide(text)]) console.log(show(JSON.parse(each)));
}
