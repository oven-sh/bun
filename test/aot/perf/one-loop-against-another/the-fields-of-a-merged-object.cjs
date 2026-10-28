// `sum = (sum + merged.a * merged.b - merged.c) | 0` and `sum += merged.a + merged.b + merged.c` over an object put together from defaults and options,
// by a spread and by Object.assign onto an empty literal, beside the same loops over a literal with the same fields.
const defaults = { a: 1, b: 2 };
function spread(options) {
  return { ...defaults, ...options };
}
function assign(options) {
  return Object.assign({}, defaults, options);
}
const written = { a: 1, b: 2, c: 3 };
const spreadOut = spread({ c: 3 });
const assigned = assign({ c: 3 });

function productsOfWritten(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum = (sum + written.a * written.b - written.c) | 0;
  return sum;
}
function productsOfSpread(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum = (sum + spreadOut.a * spreadOut.b - spreadOut.c) | 0;
  return sum;
}
function productsOfAssigned(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum = (sum + assigned.a * assigned.b - assigned.c) | 0;
  return sum;
}
function sumsOfWritten(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += written.a + written.b + written.c;
  return sum;
}
function sumsOfSpread(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += spreadOut.a + spreadOut.b + spreadOut.c;
  return sum;
}
function sumsOfAssigned(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += assigned.a + assigned.b + assigned.c;
  return sum;
}

const [loop = "", turns = "5000"] = process.argv.slice(2);
console.log(productsOfWritten(5000), productsOfSpread(5000), productsOfAssigned(5000));
console.log(sumsOfWritten(5000), sumsOfSpread(5000), sumsOfAssigned(5000));
const rounds = Number(turns);
if (loop === "products of a literal") console.log(productsOfWritten(rounds));
if (loop === "products of a spread") console.log(productsOfSpread(rounds));
if (loop === "products of an assigned object") console.log(productsOfAssigned(rounds));
if (loop === "sums of a literal") console.log(sumsOfWritten(rounds));
if (loop === "sums of a spread") console.log(sumsOfSpread(rounds));
if (loop === "sums of an assigned object") console.log(sumsOfAssigned(rounds));
