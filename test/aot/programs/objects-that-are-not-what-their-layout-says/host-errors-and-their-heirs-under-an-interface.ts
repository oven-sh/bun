// A class below Error, a plain class, host errors and a literal under one interface
interface HasMessage {
  message: string;
}
class Mine extends Error {
  code = 7;
}
class Plain implements HasMessage {
  message = "plain class";
}
function tell(x: HasMessage): string {
  return (
    x.message +
    "|" +
    Error.isError(x) +
    "|" +
    (x instanceof Error) +
    "|" +
    (x instanceof Mine) +
    "|" +
    Object.keys(x).join()
  );
}
const list: HasMessage[] = [
  new Mine("mine"),
  new Plain(),
  new Error("host"),
  { message: "literal" },
  new AggregateError([], "many"),
  new DOMException("dom"),
];
for (let round = 0; round < 3; round++) for (const x of list) console.log(tell(x));
