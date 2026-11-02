// Closures in a loop share or not: compiled answers as plain.
const fs = [],
  gs = [];
for (let i = 0; i < 3; i++) {
  fs.push(() => i);
  i += 0;
}
for (var j = 0; j < 3; j++) gs.push(() => j);
console.log(fs.map(f => f()).join(), gs.map(f => f()).join());
