// The callee is an object, an array or a class instance, not a function. The message names it as the call is written, wherever the call stands: in a `try`, in the middle of a function, as an argument, in a loop.
const parsed = JSON.parse('{ "member": {}, "list": [] }');
const known = {};
class Point {}
function report(error) {
  console.log(error.name + ": " + error.message);
}
try {
  known();
} catch (error) {
  report(error);
}
try {
  parsed.member();
} catch (error) {
  report(error);
}
try {
  parsed.list();
} catch (error) {
  report(error);
}
function callInTheMiddle(callee) {
  let result = 1;
  try {
    result += callee();
  } catch (error) {
    report(error);
  }
  return result;
}
for (const callee of [known, parsed.member, parsed.list, new Point(), new Map(), /x/, 5, undefined, null, "text"])
  callInTheMiddle(callee);
function callWithoutTry(callee) {
  const result = callee();
  return [result];
}
try {
  callWithoutTry(new Point());
} catch (error) {
  report(error);
}
try {
  console.log(known(), "never printed");
} catch (error) {
  report(error);
}
try {
  parsed.member.call();
} catch (error) {
  report(error);
}
