interface Row { a: number; b?: string; d?: boolean; }
const parent = { inherited: 1 };
const below = (v: number): Row => Object.assign(Object.create(parent), { a: v });
const withD = (v: number): Row => ({ d: true, a: v });
const withB = (v: number): Row => ({ a: v, b: "b" + v });
const join = (s: Row, u: Row): Row => ({ ...s, ...u });
const d1 = withD(1);
const p3 = below(3);
join(p3, d1);
join(p3, withB(2));
const p630 = below(630);
const copy: Row = Object.create(Object.getPrototypeOf(p630), Object.getOwnPropertyDescriptors(p630));
join(copy, d1);
console.log(JSON.stringify(join(withD(280), copy)));
console.log(JSON.stringify(join(d1, copy)));
