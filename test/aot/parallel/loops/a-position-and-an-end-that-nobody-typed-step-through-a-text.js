// A parser as packages write them: the position and the end are handed from function to function, and no type is written anywhere. What the build makes of the loops may not show:
// every kind of value goes through them, among the integers that they are written for.
function skipValue(text, index, end, stop) {
  while (index < end) {
    const code = text.charCodeAt(index);
    if (code === 59 || code === stop) break;
    index++;
  }
  return index;
}
function skipBlanks(text, index, end) {
  while (index < end) {
    const code = text.charCodeAt(index);
    if (code !== 32 && code !== 9) break;
    index++;
  }
  return index;
}
function trailingBlanks(text, start, end) {
  while (end > start) {
    const code = text.charCodeAt(end - 1);
    if (code !== 32 && code !== 9) break;
    end--;
  }
  return end;
}
function parse(header, options) {
  const end = header.length;
  let index = skipBlanks(header, options?.start ?? 0, end);
  const start = index;
  index = skipValue(header, index, end, 65536);
  const type = header.slice(start, trailingBlanks(header, start, index)).toLowerCase();
  const parameters = Object.create(null);
  while (index < end) {
    index = skipBlanks(header, index + 1, end);
    const keyStart = index;
    while (index < end && header.charCodeAt(index) !== 61 && header.charCodeAt(index) !== 59) index++;
    if (index >= end || header.charCodeAt(index) === 59) continue;
    const key = header.slice(keyStart, trailingBlanks(header, keyStart, index)).toLowerCase();
    const valueStart = skipBlanks(header, index + 1, end);
    index = skipValue(header, valueStart, end, 65536);
    parameters[key] = header.slice(valueStart, trailingBlanks(header, valueStart, index));
  }
  return type + " " + JSON.stringify(parameters);
}
// What goes through it the build knows nothing about.
const hide = (0, eval)("x => x // ".slice(0, process.argv.length > 1000 ? 1 : 6));
const exported = hide({ parse, skipValue, skipBlanks, trailingBlanks });
let lengths = 0;
for (let round = 0; round < 2000; round++) lengths += exported.parse("  text/html ; charset = utf-8 ; boundary=x" + (round % 7), round % 3 ? undefined : { start: round % 2 }).length;
console.log(lengths);
console.log(exported.parse("application/json; charset=utf-8"));
console.log(exported.parse("application/json; charset=utf-8", { start: "3" }));
console.log(exported.parse("application/json; charset=utf-8", { start: 2.5 }));
console.log(exported.parse("application/json; charset=utf-8", { start: { valueOf: () => 12 } }));
const say = f => {
  try {
    const answer = f();
    console.log(typeof answer, String(answer));
  } catch (error) {
    console.log(error.name);
  }
};
for (const index of [0, 1, -1, 2147483646, 2147483647, 0.5, -0, NaN, Infinity, "1", "x", "", null, undefined, true, 1n, Symbol.iterator, { valueOf: () => 1 }, [2]]) {
  for (const end of [3, 0, 2147483647, 2147483649, 2.5, NaN, "3", null, undefined, true, 3n, { valueOf: () => 2 }]) {
    say(() => exported.skipValue("ab;d", index, end, 100));
    say(() => exported.trailingBlanks("ab  ", index, end));
  }
}
say(() => exported.skipValue("ab;d", -2147483648, -2147483645, 100));
say(() => exported.trailingBlanks("ab  ", -2147483650, -2147483647));
