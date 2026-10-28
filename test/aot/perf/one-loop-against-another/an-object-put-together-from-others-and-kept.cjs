// An object that is put together from other objects, by spreads and as the rest of a pattern, and then kept, beside a literal with the same fields that is kept.
const kept = [];
const defaults = { host: "localhost", port: 80, secure: false };
const given = { port: 8080, path: "/" };
const record = { id: 7, name: "seven", secret: "x", age: 30 };
const records = [
  { id: 6, name: "six", secret: "w", age: 20 },
  { secret: "y", id: 8, name: "eight" },
  { name: "nine", secret: "z", id: 9, age: 3, more: 1 },
];

function keepLiteral(i) {
  const options = { host: defaults.host, port: given.port, secure: defaults.secure, path: given.path };
  kept[i & 7] = options;
  return options.port + options.host.length + options.path.length + (i & 3);
}
function keepSpreads(i) {
  const options = { ...defaults, ...given };
  kept[i & 7] = options;
  return options.port + options.host.length + options.path.length + (i & 3);
}
function keepRest(i) {
  const { secret, ...visible } = record;
  kept[i & 7] = visible;
  return visible.id + visible.age + visible.name.length + secret.length + (i & 3);
}
function keepRestOfOneOfThree(i) {
  const { secret, ...visible } = records[i % 3];
  kept[i & 7] = visible;
  return visible.id + visible.name.length + secret.length + (i & 3);
}

function literals(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum = (sum + keepLiteral(i)) | 0;
  return sum;
}
function spreads(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum = (sum + keepSpreads(i)) | 0;
  return sum;
}
function rests(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum = (sum + keepRest(i)) | 0;
  return sum;
}
function restsOfOneOfThree(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum = (sum + keepRestOfOneOfThree(i)) | 0;
  return sum;
}

const [loop = "", turns = "5000"] = process.argv.slice(2);
let warmedUp = 0;
for (let round = 0; round < 10; round++)
  warmedUp = (warmedUp + literals(500) + spreads(500) + rests(500) + restsOfOneOfThree(500)) | 0;
console.log(warmedUp, JSON.stringify(kept));
const rounds = Number(turns);
if (loop === "literals") console.log(literals(rounds));
if (loop === "spreads of two objects") console.log(spreads(rounds));
if (loop === "the rest of a record") console.log(rests(rounds));
if (loop === "the rest of one of three records") console.log(restsOfOneOfThree(rounds));
