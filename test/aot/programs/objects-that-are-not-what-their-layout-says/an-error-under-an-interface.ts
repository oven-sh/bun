// An interface that an Error satisfies: what is asked of the object is answered by the object
interface HasMessage {
  message: string;
}
function tell(x: HasMessage): string {
  return x.message + "|" + Error.isError(x) + "|" + (x instanceof Error) + "|" + Object.keys(x).join();
}
const list: HasMessage[] = [{ message: "plain" }, new Error("boom"), new RangeError("range")];
for (let round = 0; round < 3; round++) for (const x of list) console.log(tell(x));
