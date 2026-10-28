// An Error and a function with added fields satisfy an intersection of two interfaces
interface A {
  a: number;
}
interface B {
  b: string;
}
function tell(v: Readonly<A & B>): string {
  return v.a + "|" + v.b + "|" + Object.keys(v).join() + "|" + (v instanceof Error) + "|" + Error.isError(v);
}
const e = Object.assign(new Error("both"), { a: 1, b: "x" });
const list: (A & B)[] = [{ a: 2, b: "y" }, e, Object.assign(() => 0, { a: 3, b: "z" })];
for (let round = 0; round < 3; round++) for (const v of list) console.log(tell(v));
