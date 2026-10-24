// A call in tail position wrapped in `as`, `!` or parentheses is still a tail call: recursion 300,000 deep must not overflow the stack. Output must match plain Bun.
const untyped: any = {};
function underAs(n: number): number {
  if (n === 0) return 0;
  return untyped.underAs(n - 1) as number;
}
function underAsInParentheses(n: number): number {
  if (n === 0) return 0;
  return (untyped.underAsInParentheses(n - 1) as number);
}
function underTwo(n: number): number {
  if (n === 0) return 0;
  return untyped.underTwo(n - 1) as unknown as number;
}
function underAsOfAnObject(n: number): { depth: number } {
  if (n === 0) return { depth: 0 };
  return untyped.underAsOfAnObject(n - 1) as { depth: number };
}
function underAsOfAString(n: number): string {
  if (n === 0) return "bottom";
  return untyped.underAsOfAString(n - 1) as string;
}
function underNonNull(n: number): number {
  if (n === 0) return 0;
  return untyped.underNonNull(n - 1)!;
}
function plain(n: number): number {
  if (n === 0) return 0;
  return untyped.plain(n - 1);
}
function typedUnderAs(n: number): number {
  if (n === 0) return 0;
  return typedUnderAs(n - 1) as number;
}
function inAConditional(n: number): number {
  return n === 0 ? 0 : (untyped.inAConditional(n - 1) as number);
}
const arrow = (n: number): number => (n === 0 ? 0 : (untyped.arrow(n - 1) as number));
Object.assign(untyped, { underAs, underAsInParentheses, underTwo, underAsOfAnObject, underAsOfAString, underNonNull, plain, typedUnderAs, inAConditional, arrow });
for (const name of Object.keys(untyped)) {
  try {
    console.log(name, JSON.stringify(untyped[name](300000)));
  } catch (error) {
    console.log(name, "throws", (error as Error).constructor.name);
  }
}
