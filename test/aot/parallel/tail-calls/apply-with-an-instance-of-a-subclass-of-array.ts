// apply and Reflect.apply in tail position are handed an instance of a subclass of Array with an iterator of its own and a hole
let log: string[] = [];
class List extends Array<unknown> {}
(List.prototype as any)[Symbol.iterator] = function* () {
  log.push("iterated");
  yield "never";
};
function target(this: unknown, ...values: unknown[]): string {
  return values.length + "/" + values.map(String).join();
}
function byApply(f: any, t: unknown, list: any): unknown {
  return f.apply(t, list);
}
function byReflect(f: any, t: unknown, list: any): unknown {
  return Reflect.apply(f, t, list);
}
function made() {
  const list = new List(3);
  list[0] = "a";
  list[2] = "c";
  return list;
}
function deed(list: () => unknown) {
  log = [];
  return String(byApply(target, "t", list())) + " " + String(byReflect(target, "t", list())) + " " + log.join();
}
console.log(deed(() => [1, 2]));
for (let i = 0; i < 4; i++) console.log(deed(() => [i]));
console.log(deed(made));
console.log(deed(() => [3]));
