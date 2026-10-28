// A literal and Errors go through one untyped function
function tell(x) {
  return x.message + "|" + Error.isError(x) + "|" + (x instanceof Error) + "|" + Object.keys(x).join();
}
const list = [{ message: "plain" }, new Error("boom"), new RangeError("range")];
for (let round = 0; round < 3; round++) for (const x of list) console.log(tell(x));
