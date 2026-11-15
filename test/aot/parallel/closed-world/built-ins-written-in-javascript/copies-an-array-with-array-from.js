// One function of Bun's library runs for every call of Array.from: it reads Symbol.iterator from its operand, goes over it and hands it on to a fast path, and the compiler does not follow the operand there. None of that is a sign of code that nobody compiles: the executable holds little more than one that prints a number.
// STATISTIC: ImageFunctionsEmitted <= 24
const world = [{ hits: 0 }, { hits: 0 }];
Array.from(world).forEach(body => {
  body.hits++;
});
console.log(world[0].hits, world[1].hits);
