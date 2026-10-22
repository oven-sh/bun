// Hot reads under names that are made while the program runs: they are cached in the hashed slot table. argv: shapes, names a shape, rounds.
const shapes = Number(process.argv[2] ?? 20), namesPerShape = Number(process.argv[3] ?? 15), rounds = Number(process.argv[4] ?? 1000);
const objects = [], names = [];
for (let n = 0; n < namesPerShape; n++) names.push("made" + n + String.fromCharCode(97 + (n % 26)));
for (let s = 0; s < shapes; s++) {
  const object = {};
  object["shape" + s] = s;
  for (const name of names) object[name] = s + name.length;
  objects.push(object);
}
let sum = 0;
for (let round = 0; round < rounds; round++) for (const object of objects) for (const name of names) sum += object[name];
console.log(sum);
