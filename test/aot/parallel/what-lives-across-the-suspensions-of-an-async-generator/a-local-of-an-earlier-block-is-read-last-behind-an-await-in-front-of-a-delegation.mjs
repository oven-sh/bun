// Under: --aot-check=Validate: behind each suspension the body names anew what it reads out of its frame in the heap; a compiler that checks itself looks at every such name
const log = [];
const done = () => console.log("SAID " + log.join(" "));
function sink(a, b, depth) { if (depth > 0) return sink(a, b, depth - 1); log.push(a.tag + b); }
function make(tag, depth) { if (depth > 0) return make(tag, depth - 1); return { tag }; }
async function* inner() { yield "i1"; yield "i2"; }
const show = (step) => log.push(step.value + "/" + step.done);
async function* outer(flag) {
  const w = make("w", 1);
  if (flag) log.push("side");
  const r = await "a";
  sink(w, r, 1);
  yield* inner();
}
for await (const x of outer(true)) log.push(x);
done();
