// A type parameter bounded by an interface takes a literal, an Error and an instance of a class
interface HasMessage {
  message: string;
}
function pick<T extends HasMessage>(x: T): T {
  return x;
}
function tell<T extends HasMessage>(x: T): string {
  const y = pick(x);
  return y.message + "|" + Error.isError(y) + "|" + (y instanceof Error) + "|" + Object.keys(y).join();
}
class Note implements HasMessage {
  constructor(public message: string) {}
}
for (let round = 0; round < 3; round++) {
  console.log(tell({ message: "plain" }));
  console.log(tell(new Error("boom")));
  console.log(tell(new Note("note")));
}
