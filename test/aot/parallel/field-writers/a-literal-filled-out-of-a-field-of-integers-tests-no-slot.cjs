// A literal is filled with what fields of another object hold, is kept in a list and read. The other object is stored integers and texts alone, once more behind its creation,
// so that what the build knows of it is what was stored there. No read of the literal asks whether its slot is filled.
// COUNT: operations <= 20
// COUNT: arrivals <= 5
// COUNT: branches <= 8100
const kept = [];
const given = { port: 8080, path: "/" };
given.port = 8080;
given.path = "/";
function keep(i) {
  const options = { port: given.port, path: given.path, turn: i & 3 };
  kept[i & 7] = options;
  return options.port + options.path.length + options.turn;
}
let sum = 0;
for (let i = 0; i < 4000; i++) sum += keep(i);
console.log(sum, JSON.stringify(kept[3]));
