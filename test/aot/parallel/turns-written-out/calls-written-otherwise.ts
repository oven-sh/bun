function sum(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) s = s * 3 + values[i]; return s; }
function withThis(this: { base: number } | undefined, ...values: number[]): number { let s = this ? this.base : -1; for (let i = 0; i < values.length; i++) s = s * 3 + values[i]; return s; }
function forwards(...values: number[]): number { return sum(...values, 1) + sum(0, ...values); }
function forwardsArguments(_a?: number, _b?: number): number { return sum.apply(null, arguments as any); }
function recursive(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) s += values[i]; return values.length ? s + recursive(...values.slice(1)) : s; }
const list = [4, 5, 6];
for (let i = 0; i < 3; i++) {
  console.log(sum.apply(null, [i, 1, 2]), sum.apply(undefined, []), (sum as any).apply(null), sum.call(null, i, 1, 2), sum(...[i, 1, 2]), sum(...list), sum(i, ...list), Reflect.apply(sum, null, [i, 2]));
  console.log(withThis.call({ base: i }, 1, 2), withThis.apply({ base: i }, [1]), withThis.call(undefined, i), forwards(i, 2), forwardsArguments(i, 7), forwardsArguments(), recursive(i, 1, 2));
  list.push(i);
}
console.log(new (function (this: any, ...values: number[]) { this.n = 0; for (let i = 0; i < values.length; i++) this.n += values[i]; } as any)(1, 2, 3).n);
