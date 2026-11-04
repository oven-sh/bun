// apply and Reflect.apply in tail position are handed a Proxy of a list, whose traps tell what is read
let log: string[] = [];
function target(this: unknown, ...values: unknown[]): string {
  return values.length + "/" + values.join();
}
function byApply(f: any, t: unknown, list: any): unknown {
  return f.apply(t, list);
}
function byReflect(f: any, t: unknown, list: any): unknown {
  return Reflect.apply(f, t, list);
}
function proxy() {
  return new Proxy([7, 8], {
    get(list, key, receiver) {
      log.push(String(key));
      return Reflect.get(list, key, receiver);
    },
  });
}
function deed(list: () => unknown) {
  log = [];
  return String(byApply(target, "t", list())) + " " + String(byReflect(target, "t", list())) + " " + log.join();
}
console.log(deed(() => [1, 2]));
for (let i = 0; i < 4; i++) console.log(deed(() => [i]));
console.log(deed(proxy));
console.log(deed(() => [3]));
