// JSON.stringify of strings, numbers, booleans, null and undefined that the compiler does not know, with no replacer, with undefined, with null, with a function,
// with a list, and with an indentation. A replacer that is a function sees a primitive too.
const values = JSON.parse('["plain","with \\"quotes\\" and \\\\ and \\n","\\u0007\\u001f","é ü 漢字 😀","",0,-0,1,-1,2147483647,2147483648,-2147483649,1.5,1e21,1e-7,true,false,null]');
values.push(undefined, NaN, Infinity, -Infinity, "\ud800", "a\udfffb", "x".repeat(300), 10n ** 3n === 1000n, Symbol.iterator.description);
const show = text => (text === undefined ? "undefined" : text.length > 60 ? text.length + ":" + text.slice(0, 20) : text);
const stringify = JSON.stringify;
for (const value of values) {
  console.log(
    show(JSON.stringify(value)),
    show(JSON.stringify(value, undefined)),
    show(JSON.stringify(value, null)),
    show(JSON.stringify(value, null, 2)),
    show(JSON.stringify(value, undefined, "\t")),
    show(JSON.stringify(value, (key, held) => (typeof held === "number" ? held + 1 : typeof held === "string" ? held + "!" : held))),
    show(JSON.stringify(value, ["a"])),
    show(JSON.stringify(value, 7)),
    show(JSON.stringify(value, "text")),
    show(JSON.stringify(value, {})),
    show(stringify(value)),
    show(stringify(value, undefined)),
  );
}
for (const value of [Symbol("s"), () => 1, 5n, new String("boxed"), new Number(4), new Boolean(false), { toJSON() { return "from toJSON"; } }, [1, "two"], new Date(0)]) {
  try {
    console.log(show(JSON.stringify(value)), show(JSON.stringify(value, undefined)), show(JSON.stringify(value, null)));
  } catch (error) {
    console.log(error.constructor.name, error.message);
  }
}
String.prototype.toJSON = function () { return "never asked"; };
Number.prototype.toJSON = function () { return "never asked"; };
console.log(JSON.stringify(values[0]), JSON.stringify(values[7], undefined), JSON.stringify(values[15], null));
