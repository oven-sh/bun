const lists: any[] = [
  [1, 2, 3, 4, 5],
  ["a", "b", "c", "d"],
  [0.5, 1.5, 2.5, 3.5],
];
const mixed: any[] = [[1], "text", 7, null, { slice: () => [9, 9, 9] }];
class Point {
  x = 1;
  y = 2;
}
const points: any[] = [new Point(), new Point()];
const texts: any[] = ["one", "two"];
let sum = 0;
for (let i = 0; i < 60; i++) sum += lists[i % 3].slice(1, 3).length;
console.log(sum);
for (let i = 0; i < 10; i++) {
  try {
    sum += mixed[i % 5].slice(0, 2).length;
  } catch (error) {
    sum += error instanceof TypeError ? 100 : 1000;
  }
}
console.log(sum);
for (let i = 0; i < 6; i++) sum += points[i % 2].x + points[i % 2].y + texts[i % 2].length;
console.log(sum);
lists[1] = "now a string";
points[1] = { x: "x", y: 10 };
texts[0] = 5;
for (let i = 0; i < 6; i++) sum += lists[i % 3].slice(1, 3).length;
console.log(sum);
const seen: unknown[] = [];
for (let i = 0; i < 4; i++) seen.push(points[i % 2].x + points[i % 2].y, texts[i % 2].length);
console.log(seen.join());
lists.length = 0;
try {
  console.log(lists[0].slice(1));
} catch (error) {
  console.log(error instanceof TypeError);
}
