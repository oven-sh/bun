// A function left through `return f(x)` is absent from the stack trace taken in f, as in plain Bun, also where f returns a fresh object or array in registers and the function hands the parts on.
type Traced = { trace: string; depth: number };
let noise = 0;
function pad(k: number): void { for (let i = 0; i < 3; i++) noise = (noise * 31 + k + i) % 1000003; }
function pads(): void { pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8); pad(9); pad(10); pad(11); pad(12); }
const tracked = /^(traced|forwards|keepsFrame|reads|stores|calls)[A-Za-z]*$/;
function names(stack: string | undefined): string {
  const found: string[] = [];
  for (const line of (stack ?? "").split("\n")) {
    const name = line.trim().replace(/^at /, "").split(/[ @(]/)[0].replace(/^.*\./, "");
    if (tracked.test(name)) found.push(name);
  }
  return found.join(">");
}
class Report {
  traces: string[] = [];
  sum = 0;
  add(trace: string, depth: number): void { if (!this.traces.includes(trace)) this.traces.push(trace); this.sum += depth; }
  toString(): string { return this.traces.join(" | ") + " " + this.sum; }
}

// Small enough to be inlined.
function traced(depth: number): Traced { return { trace: names(new Error("here").stack), depth }; }
function forwards(depth: number): Traced { return traced(depth + 1); }
function forwardsTwice(depth: number): Traced { return forwards(depth + 1); }
function forwardsUnderCast(depth: number): Traced { return traced(depth + 1) as Traced; }
function forwardsAsWiderType(depth: number): { trace: string } { return traced(depth + 1); }

// Too large to be inlined.
function tracedLarge(depth: number): Traced { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { trace: names(new Error("here").stack), depth }; }
function forwardsLarge(depth: number): Traced { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return tracedLarge(depth + 1); }
function forwardsLargeTwice(depth: number): Traced { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return forwardsLarge(depth + 1); }
function forwardsEither(depth: number): Traced { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); if (depth & 1) return traced(depth); return tracedLarge(depth); }
function forwardsOrCreates(depth: number): Traced { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); if (depth & 1) return tracedLarge(depth); return { trace: names(new Error("created").stack), depth }; }
function tracedPair(depth: number): [string, number] { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return [names(new Error("here").stack), depth]; }
function forwardsPair(depth: number): [string, number] { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return tracedPair(depth + 1); }

// The callee is a closure or a method.
function createTracer(tag: string): (depth: number) => Traced {
  return function tracedByClosure(depth: number): Traced { return { trace: tag + names(new Error("here").stack), depth }; };
}
const tracer = createTracer("closure ");
function forwardsToClosure(depth: number): Traced { return tracer(depth + 1); }
function forwardsToLocalClosure(depth: number, tag: string): Traced {
  function tracedLocally(inner: number): Traced { return { trace: tag + names(new Error("here").stack), depth: inner }; }
  return tracedLocally(depth + 1);
}
class Tracer {
  base = 3;
  tracedByMethod(depth: number): Traced { return { trace: names(new Error("here").stack), depth: depth + this.base }; }
  forwardsByMethod(depth: number): Traced { return this.tracedByMethod(depth + 1); }
}

// Not tail calls: the frame stays.
function keepsFrameInTry(depth: number): Traced { try { return traced(depth + 1); } finally { noise = (noise + 1) % 1000003; } }
function keepsFrameInLargeTry(depth: number): Traced { pads(); try { return forwardsLarge(depth + 1); } finally { noise = (noise + 1) % 1000003; } }
function keepsFrameByReading(depth: number): Traced { const inner = forwards(depth + 1); return { trace: inner.trace, depth: inner.depth + 1 }; }
function keepsFrameOfPair(depth: number): [string, number] { const [trace, inner] = forwardsPair(depth + 1); return [trace, inner + 1]; }

function readsForwarded(n: number): string { const report = new Report(); for (let i = 0; i < n; i++) { const { trace, depth } = forwards(i); report.add(trace, depth); } return report.toString(); }
function readsForwardedTwice(n: number): string { const report = new Report(); for (let i = 0; i < n; i++) { const t = forwardsTwice(i); report.add(t.trace, t.depth); } return report.toString(); }
function readsUnderCast(n: number): string { const report = new Report(); for (let i = 0; i < n; i++) { const { trace, depth } = forwardsUnderCast(i); report.add(trace, depth); } return report.toString(); }
function readsWiderType(n: number): string { const report = new Report(); for (let i = 0; i < n; i++) report.add(forwardsAsWiderType(i).trace, i); return report.toString(); }
function readsLarge(n: number): string { const report = new Report(); for (let i = 0; i < n; i++) { const { trace, depth } = forwardsLarge(i); report.add(trace, depth); } return report.toString(); }
function readsLargeTwice(n: number): string { const report = new Report(); for (let i = 0; i < n; i++) { const { trace, depth } = forwardsLargeTwice(i); report.add(trace, depth); } return report.toString(); }
function readsEither(n: number): string { const report = new Report(); for (let i = 0; i < n; i++) { const { trace, depth } = forwardsEither(i); report.add(trace, depth); } return report.toString(); }
function readsForwardedOrCreated(n: number): string { const report = new Report(); for (let i = 0; i < n; i++) { const { trace, depth } = forwardsOrCreates(i); report.add(trace, depth); } return report.toString(); }
function readsPair(n: number): string { const report = new Report(); for (let i = 0; i < n; i++) { const [trace, depth] = forwardsPair(i); report.add(trace, depth); } return report.toString(); }
function readsFromClosure(n: number): string { const report = new Report(); for (let i = 0; i < n; i++) { const { trace, depth } = forwardsToClosure(i); report.add(trace, depth); } return report.toString(); }
function readsFromLocalClosure(n: number): string { const report = new Report(); for (let i = 0; i < n; i++) { const { trace, depth } = forwardsToLocalClosure(i, "local "); report.add(trace, depth); } return report.toString(); }
function readsFromMethod(n: number): string { const report = new Report(); const receiver = new Tracer(); for (let i = 0; i < n; i++) { const { trace, depth } = receiver.forwardsByMethod(i); report.add(trace, depth); } return report.toString(); }
function readsKeptFrames(n: number): string {
  const report = new Report();
  for (let i = 0; i < n; i++) {
    const inTry = keepsFrameInTry(i); report.add(inTry.trace, inTry.depth);
    const inLargeTry = keepsFrameInLargeTry(i); report.add(inLargeTry.trace, inLargeTry.depth);
    const { trace, depth } = keepsFrameByReading(i); report.add(trace, depth);
    const [pairTrace, pairDepth] = keepsFrameOfPair(i); report.add(pairTrace, pairDepth);
  }
  return report.toString();
}

// The object itself is needed: it is stored, or the forwarding function is called by value.
const stored: Traced[] = [];
function storesForwarded(n: number): string {
  for (let i = 0; i < n; i++) { stored.push(forwardsTwice(i)); stored.push(forwardsLargeTwice(i)); }
  const report = new Report();
  for (const t of stored) report.add(t.trace, t.depth);
  return report.toString();
}
function callsByValue(): string { return [forwards, forwardsTwice, forwardsLarge, forwardsLargeTwice, forwardsEither, forwardsToClosure].map(f => f(1).trace).join(" | "); }

console.log(readsForwarded(30));
console.log(readsForwardedTwice(30));
console.log(readsUnderCast(30));
console.log(readsWiderType(30));
console.log(readsLarge(30));
console.log(readsLargeTwice(30));
console.log(readsEither(30));
console.log(readsForwardedOrCreated(30));
console.log(readsPair(30));
console.log(readsFromClosure(30));
console.log(readsFromLocalClosure(30));
console.log(readsFromMethod(30));
console.log(readsKeptFrames(30));
console.log(storesForwarded(10));
console.log(callsByValue());
console.log(noise);
export {};
