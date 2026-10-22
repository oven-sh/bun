const table = {
  a() { return "a is called"; },
  b() { return "b is called"; },
};
function call(x: "a" | "b", k: "a") {
  if (x === k) return "the same";
  return table[x]();
}
console.log(call("a", "b" as any), call("b", "a"), call("a", "a"));

function pick(o: Record<string, string>, x: string, k: "a"): string | number {
  if (x === k) return 0;
  return o[x];
}
const picked = pick({ a: "one", b: "two" }, "a", "b" as any);
console.log(typeof picked, picked);

function same(x: any, k: "a"): unknown {
  if (x === k) return x;
  return 0;
}
const answered = same("b", "b" as any);
console.log(typeof answered, answered);

function callSame(x: any, k: "a") {
  if (x === k) return table[x as "a" | "b"]();
  return "another";
}
console.log(callSame("b", "b" as any), callSame("a", "a"));

function rest(x: boolean | string, k: true): unknown {
  if (x === k) return 0;
  return x;
}
const left = rest(true, false as any);
console.log(typeof left, left, typeof rest("text", true));
