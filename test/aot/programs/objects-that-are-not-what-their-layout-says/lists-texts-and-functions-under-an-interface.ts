// An interface with `length` takes a list, a text, a function and a typed array
interface Long {
  length: number;
}
function tell(v: Long): string {
  return (
    v.length + "|" + Array.isArray(v) + "|" + typeof v + "|" + (v instanceof Array) + "|" + (v instanceof Function)
  );
}
const list: Long[] = [
  { length: 9 },
  [1, 2, 3],
  "text",
  function (a: number, b: number) {
    return a + b;
  },
  new Uint16Array(4),
];
for (let round = 0; round < 3; round++) for (const v of list) console.log(tell(v));
