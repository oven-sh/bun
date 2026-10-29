class Dot { x = 0.5; y = 1.5; area = 2.5; }
const point = { x: 0.5, y: 1.5, name: "n" };
const chain = { value: 0.5, next: { value: 1.5 } };
const counter = { count: 0.5, bump() {} };
const pair = { first: 0.5, second: "s" };
const tree = { size: 0.5, children: [{ size: 1.5, children: [] }] };
const callable = Object.assign(() => {}, { calls: 0.5 });
const indexed: { [key: string]: unknown; total: number } = { total: 0.5 };
const only = { x: 0.25 };
const area = { area: 0.75 };
console.log(new Dot().x + point.x + chain.value + chain.next.value + counter.count + pair.first + tree.size + tree.children[0].size + callable.calls + indexed.total + only.x + area.area);
export {};
