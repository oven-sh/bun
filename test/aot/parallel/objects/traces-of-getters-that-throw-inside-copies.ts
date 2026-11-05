// Where a getter throws inside a copy, the trace names the same frames.
function frames(error: unknown): string {
  return String((error as Error).stack).split("\n").slice(0, 6).map(line => line.trim().replace(/\(?[^ ()]*[\\/]/, "(")).join(" | ");
}
const source = (): any => ({ a: 1, get b(): number { throw new RangeError("from b"); }, c: 3 });
function inTail(value: any) { return Object.assign({}, value); }
function notInTail(value: any) { const made = Object.assign({}, value); return made; }
function twoInTail(value: any) { return Object.assign({}, { z: 1 } as any, value); }
function twoNotInTail(value: any) { const made = Object.assign({}, { z: 1 } as any, value); return made; }
function firstOfTwo(value: any) { const made = Object.assign({}, value, { z: 1 }); return made; }
function labelled(value: any) { const made = Object.assign({ label: 0 }, value); return made; }
function spread(value: any) { const made = { ...value }; return made; }
function rest(value: any) { const { a, ...others } = value; return others; }
for (const run of [inTail, notInTail, twoInTail, twoNotInTail, firstOfTwo, labelled, spread, rest]) {
  for (let turn = 0; turn < 3; turn++) {
    try { run(source()); } catch (error) { if (turn === 2) console.log(run.name + ": " + frames(error)); }
  }
}
try { Object.assign({}, new Proxy({}, { ownKeys() { throw new TypeError("from keys"); } }) as any); } catch (error) { console.log(frames(error)); }
