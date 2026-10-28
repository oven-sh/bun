// A module variable and a captured parameter typed by an interface hold a literal, then an Error
interface HasMessage {
  message: string;
}
let current: HasMessage = { message: "first" };
function tell(): string {
  return current.message + "|" + Error.isError(current) + "|" + (current instanceof Error);
}
function set(next: HasMessage) {
  current = next;
}
console.log(tell());
set(new Error("second"));
console.log(tell());
set({ message: "third" });
console.log(tell());
function counter(held: HasMessage) {
  return () => held.message + "|" + Error.isError(held);
}
for (const f of [counter({ message: "c1" }), counter(new Error("c2"))]) console.log(f(), f());
