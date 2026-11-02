// Callbacks handed over: what a FinalizationRegistry hands its function as `this`, asked in several ways that have to agree with each other.
const seen = new Set();

function cleanUp(held) {
  "use strict";
  seen.add([this === undefined, this == null, typeof this, this === cleanUp, typeof held].join());
}

const registry = new FinalizationRegistry(cleanUp);
function fill() {
  for (let i = 0; i < 2000; i++) registry.register({ i }, "held " + i);
}
fill();
for (let round = 0; round < 50 && !seen.size; round++) {
  Bun.gc(true);
  await new Promise(resolve => setTimeout(resolve, 5));
}
console.log([...seen].join(" | "));
