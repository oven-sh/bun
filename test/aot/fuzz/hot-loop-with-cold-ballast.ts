// The top level of a module runs once, so it is never hot, and most stored programs keep their code there: the passes
// that only run on hot code never see it. `inHotLoop` moves a file's text into a function that a loop calls.
//
// The loop alone is not enough. Heat is relative: only the hottest fifth of a program's code is hot, and the inner loops
// of the program take that fifth. So code that runs once follows the loop, about four times the size of the program, and
// everything the loop calls is hot at default flags.
//
// Plain Bun runs the same text, so it stays the reference.
//
// Before you believe a finding: in a loop plain Bun's own answer can change with its JIT tier, and twelve turns never
// warm it up. Run the plain side several times, once with BUN_JSC_useJIT=0, and once warm (100,000 turns or more of the
// function that differs). If any tier of plain Bun gives the executable's answer, it is not a bug in the compiler. The
// bits of a NaN read through a second view are the usual case.
const turns = 12;
const maxBallastStatements = 12_000;

// What such a file does only works at the top level, ends the process, leaves work behind for a later turn, or asks what the collector has freed.
const isLeftAlone =
  /^\s*(import|export)\b|\bimport\s*\(|\brequire\s*\(|\bimport\.meta\b|^\s*(declare|namespace|module)\b|\bmodule\.exports\b|\bexports\.|^#!|process\.exit|process\.on\(|\bWorker\b|setTimeout|setInterval|setImmediate|nextTick|queueMicrotask|Bun\.serve|node:|FinalizationRegistry|WeakRef|heapStats|\bgc\(/m;

export function inHotLoop(text: string, extension: "ts" | "js"): string | undefined {
  if (isLeftAlone.test(text)) return;
  const waits = /\bawait\b|\.then\(/.test(text);
  const ballast = Array.from(
    { length: Math.min(text.length >> 2, maxBallastStatements) },
    (_, index) => `ballast.push(ballast.length + ${index % 97});\n`,
  ).join("");
  return `${waits ? "async " : ""}function programInLoop() {
${text.trimEnd()}
}
for (let turn = 0; turn < ${turns}; turn++) ${waits ? "await " : ""}programInLoop();
const ballast${extension === "ts" ? ": number[]" : ""} = [];
${ballast}console.log(ballast.length);
`;
}
