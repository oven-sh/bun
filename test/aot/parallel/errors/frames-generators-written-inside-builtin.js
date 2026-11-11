// A generator that is written inside a built-in function is listed where it throws and where what it calls throws, whether programs can call that built-in function or not.
// The line and the column inside a built-in function are left out.
const frames = error =>
  error.stack
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/native:\d+:\d+/, "native").replace(/\(?[^ (]*[\\/]/, "("))
    .join(" | ");
const uneven = () => [[1], [2, 3]];
const cases = {
  zipSpread() { return [...Iterator.zip(uneven(), { mode: "strict" })]; },
  zipNext() { const zipped = Iterator.zip(uneven(), { mode: "strict" }); zipped.next(); const last = zipped.next(); return last; },
  zipForOf() { for (const row of Iterator.zip(uneven(), { mode: "strict" })); },
  zipKeyedSpread() { return [...Iterator.zipKeyed({ a: [1], b: [2, 3] }, { mode: "strict" })]; },
  zipOfAnIteratorThatThrows() { return [...Iterator.zip([[1], { [Symbol.iterator]() { return { next() { throw new TypeError("mine"); } }; } }])]; },
  concatOfNoIterator() { return [...Iterator.concat([1], { [Symbol.iterator]() { return 5; } })]; },
  flatMapOfNoIterator() { return [...[1].values().flatMap(() => 5)]; },
  mapWhoseFunctionThrows() { return [...[1, 2].values().map(() => { throw new TypeError("mine"); })]; },
  mapOfNoResult() { const mapped = Iterator.from({ next() { return 5; } }).map(x => x); const first = mapped.next(); return first; },
  nextOfNoHelper() { const next = [1].values().map(x => x).next; const first = next.call(5); return first; },
};
if (typeof Iterator.zip === "function" && typeof Iterator.concat === "function")
  for (let round = 0; round < 2; round++)
    for (const [name, run] of Object.entries(cases)) {
      try {
        run();
        console.log(name, "throws nothing");
      } catch (error) {
        console.log(name, error.constructor.name, frames(error));
      }
    }
