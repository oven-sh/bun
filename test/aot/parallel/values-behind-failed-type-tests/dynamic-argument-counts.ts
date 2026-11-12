const seen: unknown[] = [];
function record(first: any = "one", second: any = first) {
  seen.push(first, second);
}
record();
record.call(null);
record.apply(null, [undefined, 5] as any);
record(...([1] as [any]));
[7, undefined, null].forEach(record as any);
Reflect.apply(record, null, []);
new (class { constructor(value: any = 3) { seen.push(value); } } as any)(...[undefined]);
console.log(seen.map(String).join());
