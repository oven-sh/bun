// Patterns over objects and arrays, with defaults, rests and nesting.
const point = { x: 1, y: 2, nested: { z: [3, 4, 5] }, extra: "e" };
const {
  x,
  y: renamed,
  nested: {
    z: [first, , third = 9, fourth = 10],
  },
  missing = "default",
  ...rest
} = point as typeof point & { missing?: string };
console.log(x, renamed, first, third, fourth, missing, rest);
let p = 1,
  q = 2;
[p, q] = [q, p];
console.log(p, q);
function area({ width = 1, height = width }: { width?: number; height?: number } = {}): number {
  return width * height;
}
console.log(area(), area({ width: 3 }), area({ width: 2, height: 5 }));
const [head, ...tail] = "abc";
console.log(head, tail);
for (const [key, value] of Object.entries({ a: 1, b: 2 })) console.log(key, value);
const key = "dynamic";
const { [key]: computed = "none" } = { dynamic: "found" } as Record<string, string>;
console.log(computed);
