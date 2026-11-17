function say(value: unknown): string {
  return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value);
}
const sly = { valueOf() { calls++; return 7; } };
let calls = 0;
const values: unknown[] = JSON.parse('[true,false,null,0,-1,1.5,1e21,"","  12  ","0x1f","1e3","12px","Infinity","-0",[],[5],[1,2],{},"\\u00e9","\\u4e00"]');
values.push(undefined, -0, NaN, Infinity, 10n, -(2n ** 70n), sly, new Date(86400000), Object(3n), new Number(4), new String("5"), () => 1, { toString() { return "8"; } }, { [Symbol.toPrimitive]() { return 9n; } });
function all(list: unknown[]): string {
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) out.push(say(Number(list[i])));
  return out.join();
}
function refused(list: unknown[]): string {
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    try {
      out.push(say(Number(list[i])));
    } catch (error) {
      out.push((error as Error).constructor.name);
    }
  }
  return out.join();
}
function summed(list: unknown[], turns: number): number {
  let sum = 0;
  for (let t = 0; t < turns; t++) for (let i = 0; i < 6; i++) sum += Number(list[i]);
  return sum;
}
console.log(all(values), calls);
console.log(refused([Symbol("s"), Symbol.iterator, { valueOf() { throw new RangeError("no"); } }, { [Symbol.toPrimitive]() { return {}; } }, Object.create(null), 1]));
console.log(summed(values, 300));
