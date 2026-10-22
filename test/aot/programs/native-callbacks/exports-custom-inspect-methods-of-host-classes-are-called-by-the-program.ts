// Exports of start-up modules: classes of the host have a native custom inspect method that calls util.inspect of a start-up module; the program reads the method and calls it itself, with honest arguments, with odd ones and with none.
import { inspect } from "node:util";

const custom = Symbol.for("nodejs.util.inspect.custom");
let calls = 0;
const mine = (value: unknown, options?: unknown): string => {
  calls++;
  return "mine " + typeof value + " " + typeof options;
};

function attempt(run: () => unknown): number {
  try {
    return String(run()).length;
  } catch {
    return -1;
  }
}

const things: any[] = [new URLSearchParams("a=1"), new ReadableStream(), new WritableStream(), new TransformStream(), new URL("http://localhost/b")];
const lengths: number[] = [];
for (const thing of things) {
  lengths.push(attempt(() => thing[custom](1, {}, inspect)), attempt(() => thing[custom](1, {}, mine)), attempt(() => thing[custom]()), attempt(() => thing[custom]("deep", 5, "text")), attempt(() => thing[custom].call({}, 0, {}, mine)), attempt(() => inspect(thing, { depth: -1 })));
}
console.log(lengths.join(), calls);
