const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function parse(text: string, reviver?: any): any {
  return JSON.parse(text, reviver);
}
interface Pair { first: number; second: number }
function sum(pair: Pair): number {
  return pair.first + pair.second;
}
function show(text: string) {
  const value = parse(text);
  console.log(sum(value), Object.keys(value).join(), JSON.stringify(value), Object.getPrototypeOf(value) === Object.prototype, typeof value.__proto__);
}
leak({ first: 0, second: 0 } satisfies Pair);
console.log(sum({ first: 1, second: 2 }));
for (let round = 0; round < 3; round++) {
  show('{"first":1,"second":2}');
  show('{"first":1,"first":5,"second":2}');
  show('{"first":1,"second":2,"first":7}');
  show('{"first":1,"second":2,"second":3,"first":4}');
  show('{"__proto__":{"first":9},"second":2}');
  show('{"first":1,"__proto__":null,"second":2}');
  show('{"first":1,"second":2,"__proto__":{"third":3}}');
  show('{"first":1,"second":2,"constructor":1,"toString":2,"hasOwnProperty":3}');
}
export {};
