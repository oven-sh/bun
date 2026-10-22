// A for-of loop walks an array of fractions and calls, in each round, a function that calls itself and changes the array: a text, an object, a longer and a shorter array, a hole, a whole number. Each round sees the array as it is then, as in plain Bun.
function walk(key, numbers, into, change) {
  const helper = (a, depth) => (!depth ? a : (change(numbers, depth), helper(a, depth - 1)));
  let scale = 1;
  for (const number of numbers) {
    while (number * scale % 1 !== 0) scale *= 10;
  }
  let result = numbers[0] * scale;
  const seen = [];
  for (const number of numbers) {
    seen.push(typeof number + ":" + number);
    result = result + helper(1, 2);
  }
  into[key] = result + " " + seen.join(" ");
}
const out = {};
const nothing = () => {};
for (let round = 0; round < 200; round++) walk("warm", [0.5, 2.5, 3.5], out, nothing);
walk("text", [0.5, 2.5, 3.5, 4.5], out, (list, depth) => { if (depth === 1) list[2] = "two"; });
walk("object", [0.5, 2.5, 3.5, 4.5], out, (list, depth) => { if (depth === 1) list[3] = { valueOf() { return 9; }, toString() { return "nine"; } }; });
walk("longer", [0.5, 2.5], out, (list, depth) => { if (depth === 1 && list.length < 5) list.push(list.length + 0.5); });
walk("shorter", [0.5, 2.5, 3.5, 4.5], out, (list, depth) => { if (depth === 1) list.length = 2; });
walk("hole", [0.5, 2.5, 3.5, 4.5], out, (list, depth) => { if (depth === 1) delete list[2]; });
walk("whole", [0.5, 2.5, 3.5], out, (list, depth) => { if (depth === 1) list[1] = 7; });
for (const key of Object.keys(out)) console.log(key, out[key]);
