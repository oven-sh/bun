// The first JSON.parse<T> of a Worker reads a large text that compiled code does not accept to the end: its first or its last row is refused, or every name has to match a pattern. Each Worker is ended from outside at another moment of that first call: the main thread has made the text and timed a parse of it without a type, and the moments lie within three times as long.
import type { Schema } from "bun";

type Row = { id: number; name: string; tags: string[]; inner: { a: number; b?: string } };
type Named = { id: number; name: string & Schema.Pattern<"^name [0-9]+$"> };

const rowAt = (at: number) => ({ id: at, name: "name " + at, tags: ["t", String(at)], inner: at % 2 ? { a: at, b: "b" } : { a: at } });
const refused = { id: "no number", name: "name", tags: [], inner: { a: 1 } };

function lengthOrError(text: string): number {
  try {
    return JSON.parse<Row[]>(text).length;
  } catch (error) {
    return String(error).length;
  }
}

const kinds: Record<string, { first?: unknown; last?: unknown; work: (text: string) => unknown }> = {
  "the first row is refused and the error is read": { first: refused, work: lengthOrError },
  "the last row is refused and the error is read": { last: refused, work: lengthOrError },
  "the last row is refused and nobody looks at the error": {
    last: refused,
    work: text => {
      try {
        return JSON.parse<Row[]>(text).length;
      } catch {
        return -1;
      }
    },
  },
  "every name has to match a pattern": { work: text => JSON.parse<Named[]>(text).length },
};

if (Bun.isMainThread) {
  const rounds = Number(process.env.COUNT ?? 12);
  const rows = Array.from({ length: 60_000 }, (_, at) => rowAt(at));
  for (const [name, { first, last }] of Object.entries(kinds)) {
    const text = JSON.stringify([...(first ? [first] : []), ...rows, ...(last ? [last] : [])]);
    let once = Infinity;
    for (let turn = 0; turn < 3; turn++) {
      const began = performance.now();
      JSON.parse(text);
      once = Math.min(once, performance.now() - began);
    }
    for (let round = 0; round < rounds; round++) {
      const worker = new Worker(new URL(import.meta.url));
      const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
      await new Promise<void>(resolve => {
        worker.onmessage = () => resolve();
        worker.postMessage([name, text]);
      });
      await new Promise(resolve => setTimeout(resolve, (3 * once * round) / rounds));
      worker.terminate();
      await closed;
    }
    console.log(name + ": " + rounds + " Workers ended");
  }
} else {
  addEventListener("message", (event: MessageEvent<[string, string]>) => {
    const [name, text] = event.data;
    postMessage("ready");
    for (;;) kinds[name].work(text);
  });
}
