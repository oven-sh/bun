// `await generator.next()` goes on in its turn among the other jobs whether or not the generator, its consumer or both have lived through a collection since the last step.
const ends = {
  throws: () => { throw new Error("the end"); },
  "falls off": () => {},
};
const collections = { full: () => Bun.gc(true), none: () => {} };

async function run(end, consumer, place, collection) {
  const lines = [];
  const collect = at => { if (at === place) collections[collection](); };
  const started = [];
  let self;
  const loop = async () => {
    try { for await (const value of self) lines.push("loop got " + value); lines.push("loop ends"); } catch (error) { lines.push("loop caught " + error.message); }
  };
  const byCall = async () => { const step = await self.next(); lines.push("call got " + step.value + " " + step.done); };
  self = (async function* () {
    collect(1); yield 1; collect(2);
    started.push(loop()); collect(3);
    started.push(byCall()); collect(4);
    lines.push("started");
    ends[end]();
  })();
  async function byFunction(generator, steps) {
    for (let i = 0; i < steps; i++) {
      try { collect(5 + i); const step = await generator.next(); lines.push("hand got " + step.value + " " + step.done); } catch (error) { lines.push("hand caught " + error.message); }
    }
  }
  async function* byGenerator(generator, steps) {
    for (let i = 0; i < steps; i++) {
      try { collect(5 + i); const step = await generator.next(); lines.push("hand got " + step.value + " " + step.done); } catch (error) { lines.push("hand caught " + error.message); }
    }
  }
  async function busy(turns) { for (let i = 0; i < turns; i++) { await null; lines.push("turn " + i); } }
  const others = busy(12);
  if (consumer === "function") await byFunction(self, 3);
  else await byGenerator(self, 3).next();
  await Promise.all(started);
  await others;
  return lines.join(" . ");
}

for (const end of Object.keys(ends)) {
  for (const consumer of ["function", "generator"]) {
    const expected = await run(end, consumer, 0, "none");
    console.log(end, "|", consumer, "|", expected);
    for (let place = 1; place <= 7; place++) {
      const order = await run(end, consumer, place, "full");
      console.log(end, "|", consumer, "| a collection at", place, order === expected ? "changes nothing" : "CHANGES THE ORDER: " + order);
    }
  }
}
