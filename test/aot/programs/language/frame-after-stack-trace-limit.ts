// A trace is cut at Error.stackTraceLimit frames. Whether its last frame reads `new K` depends on the caller, which is behind the cut, also where that caller was inlined into another function, and the second time as the first.
declare const console: { log(...args: unknown[]): void }
function namesIn(stack: string | undefined): string { return (stack ?? "").split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/ ?\(?[^ (]*:\d+(:\d+)?\)?$/, "")).join(" < ") }
function leaf(): string { return namesIn(new Error("x").stack) }
function down(n: number): string { return n ? down(n - 1) + "" : leaf() }
class Made { text: string; constructor(n: number) { this.text = down(n) } }
function makes(n: number): string { return new Made(n).text }
function calls(n: number): string { return down(n) }
function throughSmall(n: number, constructs: boolean): string { return constructs ? makes(n) : calls(n) }
for (let round = 0; round < 3; round++) {
  for (let depth = 5; depth <= 11; depth++) console.log(round, depth, "constructed:", throughSmall(depth, true).split(" < ").slice(-2).join(" < "), "| called:", throughSmall(depth, false).split(" < ").slice(-2).join(" < "))
}
