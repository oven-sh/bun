class List<T> extends Array<T> {
  total(): number { return this.length; }
}
function Other(this: any) {}
Other.prototype = Object.create(List.prototype);
function measure(a: List<number>): string {
  return [Array.isArray(a), a.length, a.total(), a.push(4), a.length, a[0], a.join("-")].join();
}
console.log(measure(new (Other as any)()));
console.log(measure(Reflect.construct(List, [], Other)));
console.log(measure(new List<number>()));
let n = 0;
for (let i = 0; i < 9000; i++) {
  const a: List<number> = i % 3 === 0 ? new (Other as any)() : i % 3 === 1 ? Reflect.construct(List, [], Other) : new List<number>();
  n += measure(a).length;
}
console.log(n);
