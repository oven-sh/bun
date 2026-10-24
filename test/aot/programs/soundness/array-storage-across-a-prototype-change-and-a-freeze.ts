function reparent(a: number[], p: object): number {
  let s = a[0] + a[1];
  Object.setPrototypeOf(a, p);
  a[1] = 40;
  a[2] = a[1] + 1;
  return s + a[1] + a[0] + a[2] + a.length;
}
const withAccessor = Object.defineProperty([] as number[], 7, { get() { return 70; } });
const first = [1, 2, 3];
console.log(reparent(first, withAccessor), first.join(), first[7]);
function viaProto(a: any[], p: object) {
  const before = a[0];
  (a as any).__proto__ = p;
  a[0] = "changed";
  a.push?.("x");
  return [before, a[0], a[1], a[7], a.length];
}
console.log(JSON.stringify(viaProto(["a", "b"], withAccessor)));
function viaReflect(a: number[], p: object) {
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    total += a[i];
    if (i === 1) Reflect.setPrototypeOf(a, p);
    a[i] = total;
  }
  return total + ":" + Array.prototype.join.call(a);
}
console.log(viaReflect([1.5, 2.5, 3.5, 4.5], withAccessor));
function frozen(a: number[]) {
  let s = a[0];
  Object.freeze(a);
  try { (a as any)[0] = 9; } catch (e) { s += 100; }
  return s + a[0] + a[1];
}
console.log(frozen([1, 2, 3]), frozen([1.5, 2.5]));
