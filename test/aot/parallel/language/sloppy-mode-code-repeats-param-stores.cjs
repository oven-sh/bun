// Sloppy-mode code gives two parameters one name, stores to names called `eval` and `arguments`, declares variables and classes named `await` at the top of the file, and begins
// functions with strings that only look like the directive. Plain Bun prints another output.
function twice(a, a) {
  return a;
}
console.log("two parameters of one name:", twice(1, 2), twice.length);
function* steps(a, a) {
  yield a;
}
console.log("of a generator:", steps(1, 2).next().value);
const expression = function (a, b, a) {
  return [a, b].join();
};
console.log("of a function expression:", expression(1, 2, 3));
async function later(a, a) {
  return a;
}

function storesToArguments() {
  const lines = [arguments.length];
  arguments = 1;
  lines.push(arguments);
  ++arguments;
  lines.push(arguments);
  arguments += 1;
  lines.push(arguments);
  arguments = null;
  arguments ??= 4;
  lines.push(arguments);
  [arguments] = [5];
  lines.push(arguments);
  [...arguments] = [6];
  lines.push(arguments.join());
  ({ a: arguments } = { a: 7 });
  lines.push(arguments);
  ({ ...arguments } = { b: 8 });
  lines.push(Object.keys(arguments).join());
  for (arguments of [9, 10]);
  lines.push(arguments);
  return lines.join(" ");
}
console.log("stores to arguments:", storesToArguments("x", "y"));
function storesToEval(eval) {
  const lines = [eval];
  eval = 1;
  lines.push(eval);
  eval++;
  lines.push(eval);
  --eval;
  lines.push(eval);
  eval += 2;
  lines.push(eval);
  eval = 0;
  eval ||= 4;
  lines.push(eval);
  (eval) = 5;
  lines.push(eval);
  [eval] = [6];
  lines.push(eval);
  [eval = 7] = [];
  lines.push(eval);
  ({ eval } = { eval: 8 });
  lines.push(eval);
  ({ eval = 9 } = {});
  lines.push(eval);
  for (eval in { key: 1 });
  lines.push(eval);
  for ([eval] of [[10]]);
  lines.push(eval);
  return lines.join(" ");
}
console.log("stores to a parameter named eval:", storesToEval(0));

var await = 1;
class ReadsIt {
  x = await;
}
console.log("a variable named await at the top of the file, read by the value of a field:", new ReadsIt().x);
{
  class await {}
}
{
  let
  await = 3;
}

function escaped() {
  "use\x20strict";
  var public = 1;
  return public + (this === undefined ? " strict" : " sloppy");
}
console.log("an escape in the string:", escaped());
function continued() {
  "use str\
ict";
  var public = 2;
  return public + (this === undefined ? " strict" : " sloppy");
}
console.log("a line continuation in the string:", continued());
function inParentheses() {
  ("use strict");
  var public = 3;
  return public + (this === undefined ? " strict" : " sloppy");
}
console.log("the string in parentheses:", inParentheses());
later(1, 2).then(value => console.log("of an async function:", value));
/* Output:
two parameters of one name: 2 2
of a generator: 2
of a function expression: 3,2
stores to arguments: 2 1 2 3 4 5 6 7 b 10
stores to a parameter named eval: 0 1 2 1 3 4 5 6 7 8 9 key 10
a variable named await at the top of the file, read by the value of a field: 1
an escape in the string: 1 sloppy
a line continuation in the string: 2 sloppy
the string in parentheses: 3 sloppy
of an async function: 2
*/
