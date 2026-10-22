// Sources of a spread: each object here is only ever spread, and the copy is handed to one native caller, which calls the method it finds there with arguments of its own. The program calls the method on the source with a number. A bit is set for each such caller.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

const forStringify = { other: 1, toJSON(value: number): any { if (typeof value !== "number") bits |= 1; return 0; } };
const forString = { other: 1, toString(value: number): any { if (typeof value !== "number") bits |= 2; return 0; } };
const forNumber = { other: 1, valueOf(value: number): any { if (typeof value !== "number") bits |= 4; return 0; } };
const forResolve = { other: 1, then(value: number): any { if (typeof value !== "number") bits |= 8; return 0; } };
const forSpread = { other: 1, [Symbol.iterator](value: number): any { if (typeof value !== "number") bits |= 16; return 0; } };
const forProxy = { other: 1, get(value: number): any { if (typeof value !== "number") bits |= 32; return 0; } };
const forStream = { other: 1, start(value: number): any { if (typeof value !== "number") bits |= 64; return 0; } };
const forListener = { other: 1, handleEvent(value: number): any { if (typeof value !== "number") bits |= 128; return 0; } };
const forDescriptor = { other: 1, set(value: number): any { if (typeof value !== "number") bits |= 256; return 0; } };
const forReplace = { other: 1, [Symbol.replace](value: number): any { if (typeof value !== "number") bits |= 512; return 0; } };
const forAssigned = { other: 1, toJSON(value: number): any { if (typeof value !== "number") bits |= 1024; return 0; } };
const forRest = { other: 1, toJSON(value: number): any { if (typeof value !== "number") bits |= 2048; return 0; } };
const forNested = { other: 1, toJSON(value: number): any { if (typeof value !== "number") bits |= 4096; return 0; } };
const forTwice = { other: 1, toJSON(value: number): any { if (typeof value !== "number") bits |= 8192; return 0; } };
const forInspect = { other: 1, [Symbol.for("nodejs.util.inspect.custom")](value: number): any { if (typeof value !== "number") bits |= 16384; return 0; } };
const forSink = { other: 1, write(value: number): any { if (typeof value !== "number") bits |= 32768; return 0; } };
const forTransform = { other: 1, transform(value: number): any { if (typeof value !== "number") bits |= 65536; return 0; } };
const forInstanceOf = { other: 1, [Symbol.hasInstance](value: number): any { if (typeof value !== "number") bits |= 131072; return 0; } };
const forGroupKey = { other: 1, toString(value: number): any { if (typeof value !== "number") bits |= 262144; return 0; } };
const forServe = { other: 1, fetch(value: number): any { if (typeof value !== "number") bits |= 524288; return 0; } };
const forSort = { other: 1, compare(value: number): any { if (typeof value !== "number") bits |= 1048576; return 0; } };
const forEntries = { other: 1, run(value: number): any { if (typeof value !== "number") bits |= 2097152; return 0; } };

(forStringify as any).toJSON(1);
attempt(() => JSON.stringify({ ...forStringify }));
(forString as any).toString(1);
attempt(() => String({ ...forString }));
(forNumber as any).valueOf(1);
attempt(() => Number({ ...forNumber }));
(forResolve as any).then(1);
attempt(() => Promise.resolve({ ...forResolve }));
(forSpread as any)[Symbol.iterator](1);
attempt(() => [...({ ...forSpread } as any)]);
(forProxy as any).get(1);
attempt(() => (new Proxy({}, { ...forProxy } as any) as any).x);
(forStream as any).start(1);
attempt(() => new ReadableStream({ ...forStream } as any));
(forListener as any).handleEvent(1);
attempt(() => { const target = new EventTarget(); target.addEventListener("e", { ...forListener } as any); target.dispatchEvent(new Event("e")); });
(forDescriptor as any).set(1);
attempt(() => ((Object.defineProperty({}, "k", { ...forDescriptor } as any) as any).k = "s"));
(forReplace as any)[Symbol.replace](1);
attempt(() => "a".replace({ ...forReplace } as any, "b"));
(forAssigned as any).toJSON(1);
attempt(() => JSON.stringify(Object.assign({}, forAssigned)));
(forRest as any).toJSON(1);
attempt(() => (({ other, ...rest }: any) => JSON.stringify(rest))(forRest));
(forNested as any).toJSON(1);
attempt(() => JSON.stringify({ inner: [{ ...forNested }] }));
(forTwice as any).toJSON(1);
attempt(() => JSON.stringify({ ...{ ...forTwice } }));
(forInspect as any)[Symbol.for("nodejs.util.inspect.custom")](1);
attempt(() => Bun.inspect({ ...forInspect }));
(forSink as any).write(1);
attempt(() => new WritableStream({ ...forSink } as any).getWriter().write("c"));
(forTransform as any).transform(1);
attempt(() => new TransformStream({ ...forTransform } as any).writable.getWriter().write("c"));
(forInstanceOf as any)[Symbol.hasInstance](1);
attempt(() => ({}) instanceof ({ ...forInstanceOf } as any));
(forGroupKey as any).toString(1);
attempt(() => Object.groupBy([1], () => ({ ...forGroupKey }) as any));
(forServe as any).fetch(1);
attempt(() => Bun.serve({ port: 0, hostname: "127.0.0.1", ...forServe } as any).stop(true));
(forSort as any).compare(1);
attempt(() => [2, 1].sort(({ ...forSort } as any).compare));
(forEntries as any).run(1);
attempt(() => (Object.entries({ ...forEntries }) as any)[1][1]("s"));
setTimeout(() => console.log(bits.toString(2)), 5);
