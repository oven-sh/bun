// `(0, list.push)(value)` in a counted loop: the call has no receiver, so it fills no list.
const out = [];
function told(run) {
  try {
    out.push(String(run()));
  } catch (error) {
    out.push(error.name);
  }
}
function pushed(text) {
  const list = [1];
  for (let turn = 1; turn <= text.length; turn++) (0, list.push)(turn);
  return list.join();
}
function pushedThroughName(text) {
  const list = [];
  const add = list.push;
  for (let turn = 0; turn < text.length; turn++) add(text[turn]);
  return list.length;
}
function units(text) {
  let sum = 0;
  const list = [];
  for (let turn = 0; turn < text.length; turn++) {
    sum += (0, text.charCodeAt)(turn);
    list.push(turn);
  }
  return sum + list.length;
}
function both(text) {
  const list = [];
  for (let turn = 0; turn < text.length; turn++) {
    list.push(turn);
    if (text.length > 9) (0, list.push)(turn);
  }
  return list.join();
}
function neverRun(list) {
  for (let turn = 0; turn < list.length; turn++) (0, list.push)(turn);
}
told(() => pushed("ab"));
told(() => pushed(""));
told(() => pushedThroughName("xyz"));
told(() => pushedThroughName(""));
told(() => units("abc"));
told(() => units(""));
told(() => both("abcd"));
told(() => both("abcdefghijk"));
if (process.argv.length > 60) told(() => neverRun([1]));
console.log(out.join("\n"));
