// a wrapper hands its own arguments on to what is no function
function fine(this: unknown, f: unknown, a: unknown): string {
  return "fine " + a;
}
function wrap(this: unknown, f: any, a?: unknown): unknown {
  return f.apply(this, arguments as any);
}
function deed(f: unknown) {
  try {
    return String(wrap(f, 1));
  } catch (e) {
    return (e as Error).name + ": " + (e as Error).message;
  }
}
console.log(deed(fine));
for (let i = 0; i < 4; i++) console.log(deed(fine));
console.log(deed(5));
console.log(deed(undefined));
console.log(deed({}));
console.log(deed({ apply: 3 }));
console.log(deed(fine));
