// The top level of a module runs once, and most stored programs keep their code there. So all of it is code that runs
// at most once, each class in it is evaluated once, and the compiler leans on both. `inHotLoop` moves a file's text
// into a function that a loop calls. Every turn then evaluates the classes and makes the closures again, the file's
// variables are locals and captures, and where the call is inlined the text stands in a loop.
//
// Plain Bun runs the same text, so it stays the reference.
//
// Before you believe a finding: in a loop plain Bun's own answer can change with its JIT tier, and twelve turns never
// warm it up. Run the plain side several times, once with BUN_JSC_useJIT=0, and once warm (100,000 turns or more of the
// function that differs). If any tier of plain Bun gives the executable's answer, it is not a bug in the compiler. The
// bits of a NaN read through a second view are the usual case.
const turns = 12;

// What such a file does only works at the top level, ends the process, leaves work behind for a later turn, or asks what the collector has freed.
const isLeftAlone =
  /^\s*(import|export)\b|\bimport\s*\(|\brequire\s*\(|\bimport\.meta\b|^\s*(declare|namespace|module)\b|\bmodule\.exports\b|\bexports\.|^#!|process\.exit|process\.on\(|\bWorker\b|setTimeout|setInterval|setImmediate|nextTick|queueMicrotask|Bun\.serve|node:|FinalizationRegistry|WeakRef|heapStats|\bgc\(/m;

export function inHotLoop(text: string, extension: "ts" | "js"): string | undefined {
  if (isLeftAlone.test(text)) return;
  const waits = /\bawait\b|\.then\(/.test(text);
  return `${waits ? "async " : ""}function programInLoop() {
${text.trimEnd()}
}
for (let turn = 0; turn < ${turns}; turn++) ${waits ? "await " : ""}programInLoop();
`;
}
