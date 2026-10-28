// Says whether a function is still on the stack while the function runs whose result it keeps in a variable with a type annotation and returns right behind.
let found: (string | undefined)[] = [];
function last(x: number) {
  found = String(new Error("here").stack)
    .split("\n")
    .map(line => /at (\w+) \(/.exec(line)?.[1]);
  return x + 1;
}
function lastText(x: number): string {
  last(x);
  return "text";
}
function constantWithAType(x: number) {
  const r: number = last(x);
  return r;
}
function variableWithAType(x: number) {
  let r: unknown = last(x);
  return r;
}
function constantWithATypeAndAResultType(x: number): number {
  const r: number = last(x);
  return r;
}
function widerType(x: number): number | string {
  const r: number | string = last(x);
  return r;
}
function twoInARow(x: number): unknown {
  const first: number = last(x);
  const second: unknown = first;
  return second;
}
function withAnAssertion(x: number) {
  const r: number = last(x) as number;
  return r;
}
function textWithAType(x: number) {
  const r: string = lastText(x);
  return r;
}
function usedTwice(x: number) {
  const r: number = last(x);
  return r + r;
}
const arrowWithAType = (x: number) => {
  const r: number = last(x);
  return r;
};
class Holder {
  methodWithAType(x: number) {
    const r: number = last(x);
    return r;
  }
}
function deep(n: number): number {
  if (n === 0) return 0;
  const r: number = deep(n - 1);
  return r;
}
for (const callee of [
  constantWithAType,
  variableWithAType,
  constantWithATypeAndAResultType,
  widerType,
  twoInARow,
  withAnAssertion,
  textWithAType,
  usedTwice,
  arrowWithAType,
  new Holder().methodWithAType,
]) {
  const result = callee(1);
  console.log(callee.name, result, found.includes(callee.name) ? "is on the stack" : "is not on the stack");
}
console.log("a million levels:", deep(1000000));
