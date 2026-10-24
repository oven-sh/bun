// An object written in place as the argument of validate<T>() gives what the same object gives when it comes through a variable: the copy is only left out where nobody can tell.
import { validate } from "bun:bundle";
import type { Schema } from "bun";
interface Inner { x: number }
interface Login { name: string & Schema.MinLength<1>; tries: number & Schema.Int; inner: Inner; note?: string; size: number & Schema.Default<7> }
const order: string[] = [];
function seen<T>(label: string, value: T): T { order.push(label); return value; }
function shown(run: () => unknown): string {
  try {
    const result = run() as Record<string, unknown>;
    return JSON.stringify(result) + " keys " + Object.keys(result).join();
  } catch (error) {
    const issues = (error as Partial<Schema.Error>).issues;
    return (error as Error).name + " " + (issues ? issues.map(issue => issue.path.join(".") + " " + issue.code).join("; ") : (error as Error).message);
  }
}
function both(label: string, inPlace: () => unknown, throughVariable: () => unknown): void {
  const [first, second] = [shown(inPlace), shown(throughVariable)];
  console.log(label, first === second ? "alike" : "DIFFERENT: " + second, first);
}
const inner: Inner = { x: 1 };
const rest: Record<string, unknown> = { tries: 2, extra: true };
const text: unknown = "five";
both("declared order", () => validate<Login>({ name: "a", tries: 1, inner, size: 3 }), () => { const value: unknown = { name: "a", tries: 1, inner, size: 3 }; return validate<Login>(value); });
both("another order", () => validate<Login>({ size: 3, inner, tries: 1, name: "a" }), () => { const value: unknown = { size: 3, inner, tries: 1, name: "a" }; return validate<Login>(value); });
both("a default", () => validate<Login>({ name: "a", tries: 1, inner }), () => { const value: unknown = { name: "a", tries: 1, inner }; return validate<Login>(value); });
both("an optional member", () => validate<Login>({ note: "n", name: "a", tries: 1, inner }), () => { const value: unknown = { note: "n", name: "a", tries: 1, inner }; return validate<Login>(value); });
both("an optional member that is undefined", () => validate<Login>({ name: "a", note: undefined, tries: 1, inner }), () => { const value: unknown = { name: "a", note: undefined, tries: 1, inner }; return validate<Login>(value); });
both("an undeclared key", () => validate<Login>({ name: "a", more: 1, tries: 1, inner }), () => { const value: unknown = { name: "a", more: 1, tries: 1, inner }; return validate<Login>(value); });
both("a spread", () => validate<Login>({ name: "a", ...rest, inner }), () => { const value: unknown = { name: "a", ...rest, inner }; return validate<Login>(value); });
both("a misfit", () => validate<Login>({ name: "", tries: 1.5, inner }), () => { const value: unknown = { name: "", tries: 1.5, inner }; return validate<Login>(value); });
both("a misfit below", () => validate<Login>({ name: "a", tries: 1, inner: { x: text } }), () => { const value: unknown = { name: "a", tries: 1, inner: { x: text } }; return validate<Login>(value); });
both("a member is missing", () => validate<Login>({ name: "a", inner }), () => { const value: unknown = { name: "a", inner }; return validate<Login>(value); });
both("a getter", () => validate<Login>({ get name() { return "g"; }, tries: 1, inner }), () => { const value: unknown = { get name() { return "g"; }, tries: 1, inner }; return validate<Login>(value); });
const made = validate<Login>({ name: seen("name", "a"), inner: seen("inner", inner), tries: seen("tries", 1) });
console.log(order.join(), made.inner !== inner, made.inner.x + made.tries + made.size + made.name.length);
made.inner.x = 9;
console.log(inner.x);
