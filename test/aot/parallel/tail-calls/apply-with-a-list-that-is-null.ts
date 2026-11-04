// apply and Reflect.apply in tail position are handed null for the list
function target(this: unknown, ...values: unknown[]): string {
  return String(this) + "/" + values.length + "/" + values.join();
}
function byApply(f: any, t: unknown, list: any): unknown {
  return f.apply(t, list);
}
function byReflect(f: any, t: unknown, list: any): unknown {
  return Reflect.apply(f, t, list);
}
function deed(list: unknown) {
  let text = String(byApply(target, "t", list));
  try {
    text += " " + String(byReflect(target, "t", list));
  } catch (e) {
    text += " " + (e as Error).name + ": " + (e as Error).message;
  }
  return text;
}
console.log(deed([1, 2]));
for (let i = 0; i < 4; i++) console.log(deed([i]));
console.log(deed(null));
console.log(deed(undefined));
console.log(deed([3]));
