// STATISTIC: ArithmeticOnMarkers >= 1
// An array from a constructor has a name of the program's own. Its elements stay numbers.
function createVector(x, y, z) {
  return new Array(x, y, z);
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
const green = createVector(0, 0.5, 0.25);
const grey = createVector(0.5, 0.5, 0.5);
grey.reflection = 1;
const lights = [createVector(1, 2, 3), createVector(4, 5, 6.5)];
lights[0].colour = createVector(0.25, 0.5, 0.75);
lights[1].colour = createVector(1, 0.5, 0.125);

function shade(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const colour = i % 3 ? green : grey;
    const light = lights[i & 1];
    sum += dot(colour, light);
    if (colour.reflection > 0.5) sum += dot(light.colour, colour);
  }
  return sum;
}
console.log(shade(12), shade(300), green.reflection, grey.reflection, Object.keys(grey).join(), lights[1].colour.length);

const words = "one,two,three".split(",");
words.longest = 5;
let length = 0;
for (let i = 0; i < words.length; i++) length += words[i].length + (words.longest === words[i].length ? 100 : 0);
console.log(length, words.longest, words.shortest);

// A match has names of its own.
const match = /(\d+)-(?<second>\d+)/.exec("10-20");
match.extra = 3;
console.log(match.index, match.input, match.groups.second, match.extra, match.missing);
