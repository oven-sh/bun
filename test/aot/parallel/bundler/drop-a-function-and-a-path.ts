// Flags: --drop=assert --drop=tools.trace
// Reference: bun build --compile
declare function assert(ok: boolean): void;
declare namespace assert {
  function equal(a: unknown, b: unknown): void;
}
declare const tools: { trace: { (text: string): void; deep(text: string): void }; keep(text: string): string };
(globalThis as any).tools = {
  trace: () => {
    throw new Error("tools.trace was called");
  },
  keep: (text: string) => text,
};
let evaluated = 0;
assert(evaluated++ > 5);
assert.equal(evaluated++, 7);
tools.trace("dropped");
tools.trace.deep("dropped");
tools.trace?.deep("dropped");
try {
  tools?.trace("called: ?. is inside the dropped path");
} catch (e) {
  console.log((e as Error).message, evaluated);
}
console.log(evaluated, tools.keep("kept"));
