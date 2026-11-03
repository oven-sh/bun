// Each generator pushes several values onto its rest parameter, puts the length that push answers with twice into a list beside another value, and delegates to that list.
function* besideAnInteger(first, second, ...rest) {
  const length = rest.push(second, first);
  const list = [length, 1281758782, length];
  yield* list;
  return list;
}

function* besideAFraction(first, second, ...rest) {
  const length = rest.push(second, first, second);
  const list = [length, 1.5, length];
  yield* list;
}

function* besideAText(first, second, ...rest) {
  const length = rest.push(second, first, second, first);
  const list = [length, "middle", length];
  yield* list;
}

function* besideNothing(first, second, ...rest) {
  const length = rest.push(second, first);
  const list = [length, undefined, length];
  yield* list;
  yield* list;
}

async function* oneAtATime(first, second, ...rest) {
  const length = rest.push(second, first);
  const list = [length, 1281758782, length];
  yield* list;
}

console.log([...besideAnInteger(1, 2, 3)]);
console.log([...besideAFraction(1, 2, 3)]);
console.log([...besideAText(1, 2, 3)]);
console.log([...besideNothing(1, 2, 3)]);
console.log(await Array.fromAsync(oneAtATime(1, 2, 3)));
