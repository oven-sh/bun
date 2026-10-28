// A function returns a literal or an Error and no type is written
function make(n: number) {
  return n % 2 ? new Error("odd " + n) : { message: "even " + n };
}
function tell(n: number): string {
  const v = make(n);
  return v.message + "|" + Error.isError(v) + "|" + (v instanceof Error) + "|" + Object.keys(v).join();
}
for (let n = 0; n < 6; n++) console.log(tell(n));
const list = [new Error("in list"), { message: "in list too" }];
for (const v of list) console.log(v.message, Error.isError(v), v instanceof Error);
