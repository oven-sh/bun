// A loop stores in a global binding and adds up a list, beside an object that only the end of the function needs: the build ends.
const show = value => (Array.isArray(value) ? "[" + value.slice(0, 12).map(show) + "]" : typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) : typeof value === "function" ? "f" : typeof value === "bigint" ? value + "n" : value instanceof Map || value instanceof Set ? "{" + [...value].slice(0, 8).map(show) + "}" : ArrayBuffer.isView(value) ? "<" + Array.from(value).map(show) + ">" : typeof value === "object" && value ? "(" + Object.keys(value).slice(0, 9).map(name => name + ":" + (typeof value[name] === "object" ? "o" : show(value[name]))) + ")" : /=>|function|\) \{/.test(String(value)) ? "code" : String(value).slice(0, 30));
globalThis.b = 0;
function work(turns) {
  let list = [3, 1, 2];
  let pair = { x: 1, y: 2 };
  for (let j = 0; j < turns; j++) {
    for (let k = 0; k < 2; k++) {
      b = list.reduce((first, second) => first + second, 0);
    }
  }
  return [b, list, pair].map(show).join(" ");
}
for (const turns of [3, 5]) console.log(work(turns));
