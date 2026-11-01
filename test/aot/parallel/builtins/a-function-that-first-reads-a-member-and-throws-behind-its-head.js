// The function begins with the first read of Object.entries and is called in loops, at the top level, in a function and in a method. However much of it stands in a loop, and whether the
// first call returns or throws, the read adds the member once, and the names of Object stand as in plain Bun.
// IR+ InitializeBuiltin builtin=ObjectEntries\b
function sumOf(o, most) {
  const entries = Object.entries(o), total = entries[0][1] + entries[1][1];
  if (total > most) throw new RangeError("a sum of " + total + " is over " + most + " for " + entries.length + " entries that begin with " + entries[0][0]);
  return total;
}
function inFunction(size, turns, most) { let sum = 0; for (let n = 0; n < turns; n++) { size.width = n; sum += sumOf(size, most); } return sum; }
class Holder { inMethod(size, turns, most) { let sum = 0; for (let n = 0; n < turns; n++) { size.height = n * 0.5; sum += sumOf(size, most); } return sum; } }
const said = [];
const size = { width: 100, height: 4.5 };
try { let sum = 0; for (let n = 0; n < 50; n++) { sum += sumOf(size, 20 - n); } said.push(sum); } catch (error) { said.push(error.message); }
const names = [Object.keys(size).length];
try { said.push(inFunction(size, 50, 1000)); said.push(inFunction(size, 50, 30)); } catch (error) { said.push(error.message); }
try { said.push(new Holder().inMethod(size, 50, 1000)); said.push(new Holder().inMethod(size, 50, 40)); } catch (error) { said.push(error.message); }
({ ...Object });
console.log(said.join("\n"));
console.log(names.join(), Reflect.ownKeys(Object).join());
