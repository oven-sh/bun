// A loop at the top level of a file takes slices of lists of three kinds, so the loop of `slice` stands inside it, on a path that is not the likeliest. The file is built beside five
// entry points that hand lists of arguments on. Each entry point is a program of its own, and all share the code of the library.
import { generated } from "./generated/run-generated";

const main = `const lists: any[] = [
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
`;

const beside: Record<string, string> = {
  "an-array-like-object-is-applied.js": `function target(first, second, third, fourth, fifth) {
  console.log(first === undefined, typeof first);
  console.log(second === null, typeof second);
  console.log(third + 1, arguments.length);
}
target.apply(undefined, { length: 3, 0: undefined, 1: null, 2: 0.5 });
`,
  "an-arguments-object-is-applied.js": `let receiver;
function target(...rest) {
  console.log(rest.length);
  console.log(typeof rest[0], rest[0] + 1);
  console.log(typeof rest[1], rest[1] + 1);
  console.log(typeof rest[2], rest[2].length);
  console.log(typeof rest[3], rest[3].four);
  console.log(typeof rest[4], rest[4]());
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = undefined), relay(1, 2.5, "three", { four: 4 }, () => "five"));
`,
  "a-list-is-applied-by-reflect.js": `function report(value) {
  console.log(typeof value, value + 1);
}
function target(callback) {
  callback(1.5);
}
Reflect.apply(target, undefined, [report]);
`,
  "an-array-like-object-is-applied-by-reflect.js": `function target(first, second, third, fourth, fifth) {
  console.log(typeof first, first + 1);
  console.log(typeof second, second + 1);
  console.log(typeof third, third.length);
  console.log(typeof fourth, fourth.four);
  console.log(typeof fifth, fifth());
  console.log(arguments.length);
}
Reflect.apply(target, undefined, { length: 5, 0: 1, 1: 2.5, 2: "three", 3: { four: 4 }, 4: () => "five" });
`,
  "call-is-applied.js": `function target(first, second, third, fourth, fifth) {
  console.log(typeof fifth, fifth + 1);
}
Function.prototype.call.apply(target, [undefined, 0, 1, 2, 3, 4.5]);
`,
};

generated("a loop that takes slices of lists is built beside programs that hand lists of arguments on", [
  {
    name: "five entry points beside it.",
    isAlwaysRun: true,
    wasOnceWrong: true,
    keepsItsText: true,
    make: () => ({ file: "main.ts", text: main, files: beside, entryPoints: Object.keys(beside) }),
  },
]);
