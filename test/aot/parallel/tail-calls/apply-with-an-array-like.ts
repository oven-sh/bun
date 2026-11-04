// apply and Reflect.apply in tail position are handed an array-like whose length and elements are getters
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
function like() {
  return {
    get length() { log.push("length"); return 2; },
    get 0() { log.push("0"); return "a"; },
    get 1() { log.push("1"); return "b"; },
  };
}
function deed(list: () => unknown) {
  log = [];
  return String(byApply(target, "t", list())) + " " + String(byReflect(target, "t", list())) + " " + log.join();
}
console.log(deed(() => [1, 2]));
for (let i = 0; i < 4; i++) console.log(deed(() => [i]));
console.log(deed(like));
console.log(deed(() => [3]));
