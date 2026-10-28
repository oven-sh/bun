// Each function pushes several values onto an array, puts the length that push answers with twice into a list beside another value, and reads the list by index one place past its end.
function besideAnInteger(first, second, ...rest) {
  const length = rest.push(second, first);
  const list = [length, 1281758782, length];
  const seen = [];
  for (let index = 0; index < 4; index++) seen.push(list[index]);
  return seen;
}

function besideAFraction(first, second, ...rest) {
  const length = rest.push(second, first, second);
  const list = [length, 1.5, length];
  const seen = [];
  for (let index = 0; index < 4; index++) seen.push(list[index]);
  return seen;
}

function ontoFractions(first, second, ...rest) {
  const length = rest.push(second + 0.5, first);
  const list = [length, 1.5, length];
  const seen = [];
  for (let index = 0; index < 4; index++) seen.push(list[index]);
  return seen;
}

function ontoTexts(first, second, ...rest) {
  const length = rest.push("a", first);
  const list = [length, 1.5, length];
  const seen = [];
  for (let index = 0; index < 4; index++) seen.push(list[index]);
  return seen;
}

function ontoALocalArray(first, second) {
  const local = [first];
  const length = local.push(second, first, second, first);
  const list = [length, 1.5, length];
  const seen = [];
  for (let index = 0; index < 4; index++) seen.push(list[index]);
  return seen;
}

console.log(besideAnInteger(1, 2, 3));
console.log(besideAFraction(1, 2, 3));
console.log(ontoFractions(1, 2, 3));
console.log(ontoTexts(1, 2, 3));
console.log(ontoALocalArray(1, 2));
