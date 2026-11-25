// A Worker copies records without end, and the main thread ends it at a drawn moment, sixty times over. The record holds a name beside its fields, under a key that only the run knows, and the copy leaves that name out. Two names lie there, and both are left out.
interface Note {
  kind: "note";
  text: string;
}
const key: string = JSON.parse('"label_id"');
function label<T extends object>(entry: T, id: string): T & { label_id?: string } {
  (entry as Record<string, unknown>)[key] = id;
  return entry;
}
let sum = 0;
const ring: unknown[] = [0, 0, 0, 0];
let kept = 0;
function keep<T>(value: T): T {
  ring[kept++ & 3] = value;
  return value;
}
const second: string = JSON.parse('"late"');
function bare(entry: Record<string, unknown>) {
  const { label_id: _id, late: _late, ...rest } = entry;
  return rest;
}
function deed(): void { // @ts-expect-error
  const entry: Record<string, unknown> = label<Note>({ kind: "note", text: "t" }, "s");
  entry[second] = 1;
  sum += Object.keys(keep(bare(entry))).length;
}

if (Bun.isMainThread) {
  let ended = 0;
  for (let round = 0; round < 60; round++) {
    const worker = new Worker(new URL(import.meta.url));
    await new Promise<void>(resolve => worker.addEventListener("message", () => resolve(), { once: true }));
    await new Promise<void>(resolve => setTimeout(resolve, Math.random() * 4));
    const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    worker.terminate();
    await closed;
    ended++;
  }
  console.log("ended", ended);
} else {
  postMessage("begun");
  for (;;) {
    deed();
    if (sum === -1) postMessage(ring);
  }
}
