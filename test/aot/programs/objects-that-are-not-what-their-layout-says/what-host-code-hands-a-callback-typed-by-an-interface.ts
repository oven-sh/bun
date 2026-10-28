// A catch clause, a rejection handler and a callback of map are typed by an interface
interface HasMessage {
  message: string;
}
function tell(x: HasMessage): string {
  return x.message + "|" + Error.isError(x) + "|" + (x instanceof Error);
}
const caught: HasMessage[] = [];
try {
  (null as any).x;
} catch (e) {
  caught.push(e as HasMessage);
}
await Promise.reject(new RangeError("rejected")).catch((e: HasMessage) => caught.push(e));
[{ message: "mapped" }].map((x: HasMessage) => caught.push(x));
process.once("warning", (w: HasMessage) => console.log("warning", tell(w)));
for (let round = 0; round < 3; round++) for (const x of caught) console.log(tell(x).replace(/null.*\|/, "null|"));
