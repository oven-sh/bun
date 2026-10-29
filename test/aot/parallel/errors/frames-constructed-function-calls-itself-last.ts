// A function that calls itself last is called and constructed. Each row prints the names and the places of the frames of what the last of the calls throws.
const frames = (error: unknown) =>
  String((error as Error).stack)
    .split("\n")
    .slice(1, 5)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/\(.*[\\/]/, "(")
        .replace(/^[^ ]*[\\/]/, ""),
    )
    .join(" < ");
function countDown(steps: number): number {
  if (steps <= 0) throw new URIError("at the end");
  return countDown(steps - 1);
}
const ways: Record<string, (callee: any, steps: number) => unknown> = {
  call: (callee, steps) => [callee(steps)],
  new: (callee, steps) => [new callee(steps)],
  "Reflect.construct": (callee, steps) => [Reflect.construct(callee, [steps])],
};
for (const way in ways) {
  for (const steps of [0, 1, 3]) {
    try {
      console.log(way, steps, ways[way](countDown, steps));
    } catch (error) {
      console.log(way + " | " + steps + " | " + frames(error));
    }
  }
}
