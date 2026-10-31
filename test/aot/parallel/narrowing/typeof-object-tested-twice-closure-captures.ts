// The second test cannot pass: the first one has returned for every object. A closure behind it captures the tested value, whose written type the parsed object does not have.
// Flags: --aot-validate
interface Holder {
  inner: number;
}
function note(value: unknown) {
  console.log(value);
}
function test(value: Holder | boolean): void {
  if (typeof value === "object") return;
  if (typeof value == "object") note((() => value)());
}
test(JSON.parse("{}"));
test(JSON.parse("[]"));
test(JSON.parse("true"));
const holder: Holder = { inner: 1 };
console.log(holder.inner);
