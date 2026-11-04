// a wrapper stores into its arguments object in front of handing it on
function target(this: unknown, ...values: unknown[]): string {
  return values.length + "/" + values.join();
}
function wrap(this: unknown, a?: unknown, b?: unknown): string {
  arguments[0] = 9;
  return target.apply(this, arguments as any) + "/" + a;
}
function tail(this: unknown, a?: unknown, b?: unknown): string {
  arguments[1] = 8;
  return target.apply(this, arguments as any);
}
function deed(count: number): string {
  if (count === 0) return wrap() + " " + tail();
  if (count === 1) return wrap(1) + " " + tail(1);
  if (count === 2) return wrap(1, 2) + " " + tail(1, 2);
  return (wrap as any)(1, 2, 3) + " " + (tail as any)(1, 2, 3);
}
console.log(deed(2));
for (let i = 0; i < 4; i++) console.log(deed(i));
console.log(deed(1));
