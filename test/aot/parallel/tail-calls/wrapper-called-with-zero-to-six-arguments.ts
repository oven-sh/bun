// a wrapper with two parameters that hands its own arguments on is called with zero to six arguments
function target(this: unknown, ...values: unknown[]): string {
  return String(this) + "/" + values.length + "/" + values.join();
}
function wrap(this: unknown, a?: unknown, b?: unknown): string {
  return target.apply(this, arguments as any);
}
function deed(count: number): string {
  switch (count) {
    case 0: return wrap.call("t");
    case 1: return wrap.call("t", 1);
    case 2: return wrap.call("t", 1, undefined);
    case 3: return (wrap as any).call("t", 1, 2, 3);
    case 4: return (wrap as any).call("t", 1, 2, 3, 4);
    case 5: return (wrap as any).call("t", 1, 2, 3, 4, 5);
  }
  return (wrap as any).call("t", 1, 2, 3, 4, 5, 6);
}
console.log(deed(2));
for (let i = 0; i < 7; i++) console.log(deed(i));
console.log(deed(0));
