// A member in a pattern, or at the head of a loop, is stored to as by `=`.
const f = text => () => text;
[Promise.prototype.first] = [f("array")];
({ a: RegExp.prototype.second } = { a: f("object") });
for (Function.prototype.third of [f("loop")]);
[{ b: Promise.prototype.fourth }] = [{ b: f("nested") }];
[...RegExp.prototype.fifth] = ["rest"];
console.log(
  Promise.resolve(1).first(),
  /a/.second(),
  (() => {}).third(),
  Promise.resolve(1).fourth(),
  /a/.fifth.join(),
);
