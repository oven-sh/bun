// trimRight and trimEnd are one function object under two names. A program that replaces one of the names sees its own function under that name and the engine's under the other,
// also where the call stands in a loop and keeps a test of its own.
String.prototype.trimRight = function () {
  return "mine";
};
function right(list) {
  let result = "";
  for (let i = 0; i < list.length; i++) result += list[i].trimRight() + "|";
  return result;
}
function end(list) {
  let result = "";
  for (let i = 0; i < list.length; i++) result += list[i].trimEnd() + "|";
  return result;
}
function left(list) {
  let result = "";
  for (let i = 0; i < list.length; i++) result += list[i].trimLeft() + "|";
  return result;
}
function start(list) {
  let result = "";
  for (let i = 0; i < list.length; i++) result += list[i].trimStart() + "|";
  return result;
}
const list = [" a ", " b "];
console.log(right(list), end(list), left(list), start(list));
String.prototype.trimStart = function () {
  return "own";
};
console.log(right(list), end(list), left(list), start(list));
