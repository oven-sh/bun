// Declares a variable named `await` at the top of a CommonJS file, reads it, stores to it and calls it there. The file stays sloppy-mode code. Plain Bun prints another output.
var await = 1;
console.log("read:", await);
var copy = await;
console.log("copied:", copy);
await = 2;
console.log("stored to:", await);
await++;
console.log("counted up:", await);
console.log("in a sum:", await + 1, await - 1, await * 2);
console.log("negated behind it:", await - 1);
await += 4;
console.log("added to:", await);
[await] = [8];
console.log("out of a list:", await);
({ await } = { await: 9 });
console.log("out of an object:", await, { await }.await);
console.log("its type:", typeof await, typeof await);
function twice(a, a) {
  return a;
}
console.log("two parameters of one name:", twice(1, 2), await);
console.log(
  "this of a function:",
  (function () {
    return this === globalThis;
  })(),
);
await = function (value) {
  return "called with " + value;
};
console.log(await(3));
console.log(await`text`);
console.log(await.name, await.length);
await = [10, 11];
console.log("an element:", await[1]);
for (await of [12, 13]);
console.log("a loop variable:", await);
for (await in { key: 1 });
console.log("a key:", await);
async function waits() {
  return (await Promise.resolve(14)) + 1;
}
waits().then(value => console.log("the operator in an async function:", value));
console.log("on the module:", typeof module, typeof exports, typeof require);
