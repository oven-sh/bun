// The awaited call enters a small plain function that returns a call of an async function, once bare and once under its own try: the rejection arrives at the await of the caller and never in the handler of the small function.
const log: string[] = [];
async function fail(x: number): Promise<number> {
  await null;
  throw new Error("failed " + x);
}
const bare = (x: number) => fail(x);
const guarded = (x: number) => {
  try {
    return fail(x);
  } catch (e) {
    log.push("the small function caught it");
    return -1;
  }
};
async function run(x: number, get: "bare" | "guarded") {
  try {
    return "given " + (get === "bare" ? await bare(x) : await guarded(x));
  } catch (e) {
    return "the caller caught " + (e as Error).message;
  }
}
function deed(x: number, get: "bare" | "guarded") {
  return run(x, get);
}
console.log(await deed(1, "bare"));
console.log(await deed(2, "guarded"));
for (let i = 0; i < 4; i++) console.log(await deed(i, i % 2 ? "bare" : "guarded"));
console.log(String(log.length));
