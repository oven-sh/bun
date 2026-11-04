// A literal is filled with what fields of another object hold, is kept in a list and read. The other object is stored integers and texts alone, once more behind its creation,
// so that what the build knows of it is what was stored there. No read of the literal asks whether its slot is filled.
// COUNT: operations <= 20 Todo: the form that the name speaks of is met (the slot is read at level Proven, no test). The cell of the literal has 48 bytes where the old compiler packed an int32 and a text into 32: 30 operationAOTAllocateSlow, the first cells of two size classes. The old compiler counted 14.
// COUNT: operations <= 40
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
