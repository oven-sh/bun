// One stack holds compiled code, a native function, a function created from text and eval code in turn: a stack trace lists every frame once and in order, at every limit and from every captureStackTrace caller.
// Compiled code evaluates a text without a frame of the host's `eval`, so that line is left out here, and where frames are counted the stack has no eval code.
// The output is stored: it is what plain Bun prints without its optimizing compilers. With them the frame of String.prototype.replace is missing from some of the late stacks, in most runs.
const lines: string[] = [];
const nativeNames = ["replace", "parse", "from"];
let mode: string = "error";
let from: Function | undefined;
let holder: { stack?: unknown } = {};
let depth = 0;
let usesEval = true;
const textThrower = new Function("return function textThrower() {\n\n  throw new RangeError('text');\n};")();
function leaf(): number {
  switch (mode) {
    case "error":
      holder = new Error("created");
      break;
    case "capture":
      holder = {};
      Error.captureStackTrace(holder, from);
      break;
    case "throw":
      throw new Error("thrown");
    case "native error":
      (JSON as any)[nativeNames[1]]("{");
      break;
    case "text error":
      textThrower();
      break;
    case "again":
      if (depth > 0) {
        depth--;
        const result = ground();
        return result.length;
      }
      holder = new Error("deep");
      break;
  }
  return 1;
}
function inner(): number {
  const result = usesEval ? eval("leaf() + 1") : leaf() + 1;
  return result + 1;
}
const textMiddle = new Function("return function textMiddle(callee) {\n  const result = callee();\n  return result + 1;\n};")();
function middle(): number {
  const result = textMiddle(inner);
  return result + 1;
}
function viaNative(): string {
  const result = middle();
  return String(result);
}
function outermost(): string {
  const subject: any = "x";
  const result = subject[nativeNames[0]](/x/g, viaNative);
  return result + "!";
}
function ground(): string {
  const result = outermost();
  return result + "?";
}
function frameList(stack: unknown): string[] {
  const seen: string[] = [];
  for (const line of String(stack).split("\n")) {
    const at = /^\s+at (.*)$/.exec(line);
    if (!at) continue;
    const named = /^(.*?) \((.*)\)$/.exec(at[1]);
    const name = named ? named[1] : "";
    const where = named ? named[2] : at[1];
    const position = /:(\d+):\d+$/.exec(where) ?? /:(\d+)$/.exec(where);
    if (name === "eval" && !position) continue;
    // Plain Bun numbers the "at <parse>" line of a SyntaxError in the transpiled text.
    seen.push(name + (position && name !== "<parse>" ? "@" + position[1] : ""));
  }
  return seen;
}
const chain = new Set(["leaf", "<anonymous>", "inner", "textMiddle", "middle", "viaNative", "replace", "outermost", "ground", "parse", "<parse>", "textThrower"]);
function trace(stack: unknown): string {
  const all = frameList(stack);
  let end = 0;
  while (end < all.length && chain.has(all[end].split("@")[0])) end++;
  return all.slice(0, end).join(" ") || "(none)";
}
function walk(nesting: number): string {
  holder = {};
  depth = nesting;
  try {
    ground();
  } catch (error: any) {
    holder = error;
  }
  return trace(holder.stack);
}
function take(label: string, nesting = 0): void {
  const first = walk(nesting);
  const second = walk(nesting);
  lines.push(label + ": " + first, "  again: " + (second === first ? "same" : second));
}
function takeCallSites(): void {
  const earlier = (Error as any).prepareStackTrace;
  (Error as any).prepareStackTrace = (_error: unknown, sites: any[]) =>
    sites.map(site => [site.getFunctionName() ?? "", site.isNative() ? "native" : "", site.isEval() ? "eval" : "", site.isConstructor() ? "new" : "", site.isAsync() ? "async" : "", site.getLineNumber() ?? ""].join("/"));
  try {
    ground();
    const sites: any = (holder.stack as string[]).filter(site => !site.startsWith("eval/native/"));
    const end = sites.findLastIndex((site: string) => site.startsWith("ground/")) + 1;
    lines.push("call sites: " + (sites.slice(0, end).join(" ") || "(none)"));
  } finally {
    (Error as any).prepareStackTrace = earlier;
  }
}

Error.stackTraceLimit = 50;
for (const each of ["error", "throw", "native error", "text error"]) {
  mode = each;
  take("whole, " + each);
}
usesEval = false;
for (let limit = 0; limit <= 10; limit++) {
  Error.stackTraceLimit = limit;
  for (const each of ["error", "throw", "capture"]) {
    mode = each;
    take("limit " + limit + ", " + each);
    lines.push("  frames: " + frameList(holder.stack).length);
  }
}
mode = "capture";
for (const limit of [50, 2]) {
  Error.stackTraceLimit = limit;
  for (const caller of [leaf, inner, textMiddle, middle, viaNative, String.prototype.replace, outermost, ground, trace]) {
    from = caller;
    take("limit " + limit + ", from " + caller.name);
  }
}
from = undefined;
mode = "again";
for (const limit of [50, 12]) {
  Error.stackTraceLimit = limit;
  for (const nesting of [1, 3]) take("limit " + limit + ", nested " + nesting, nesting);
}
Error.stackTraceLimit = 50;
usesEval = true;
mode = "error";
takeCallSites();
const holders: { stack?: unknown }[] = [];
for (let run = 0; run < 3; run++) {
  ground();
  holders.push(holder);
}
holder = {};
Bun.gc(true);
const late = holders.map(each => trace(each.stack));
lines.push("read late: " + late[0], "  the other two: " + (late[1] === late[0] && late[2] === late[0] ? "same" : late[1] + " | " + late[2]));
console.log(lines.join("\n"));
export {};
