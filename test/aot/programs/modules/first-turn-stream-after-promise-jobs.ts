// A stream made in the first turn of an ES module delivers its data through process.nextTick, which comes behind the promise jobs of that turn.
import { Readable } from "node:stream";
const log: string[] = [];
const letters = Readable.from(["a"]);
letters.on("data", (letter: string) => log.push("data " + letter));
letters.on("end", () => console.log(log.join(", ")));
Promise.resolve().then(() => log.push("job 1")).then(() => log.push("job 2")).then(() => log.push("job 3"));
process.nextTick(() => log.push("tick"));
