// An array may say that it is longer than any storage of elements can be. A spread of it has nowhere to put the copies, so it fails before the first one.
function report(name, run) {
  try {
    console.log(name, run());
  } catch (error) {
    console.log(name, error.name, error.message);
  }
}

function lengthOfCopy(list) {
  return [...list].length;
}

for (const length of [4294967295, 2147483648, 268435457]) {
  const held = [];
  held.length = length;
  report(length + " alone", () => [...held].length);
  report(length + " behind an element", () => [1, ...held].length);
  report(length + " in front of an element", () => [...held, 1].length);
  report(length + " twice", () => [...held, ...held].length);
  report(length + " as a parameter", () => lengthOfCopy(held));

  const filled = [1, 2, 3];
  filled.length = length;
  report(length + " behind three elements of its own", () => [...filled].length);
}

report("a short one afterward", () => lengthOfCopy([1, , 3]));
