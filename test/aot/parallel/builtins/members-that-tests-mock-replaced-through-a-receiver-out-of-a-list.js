// Date.now, Math.random, JSON.parse and JSON.stringify are replaced through a receiver that comes out of a list that may also be a value the build knows nothing about.
const print = console.log.bind(console);
let holders = [Date, Math, JSON];
if (process.argv.length > 5) holders = globalThis[process.argv[5]];
print(typeof Date.now(), Math.random() < 1, JSON.parse("[1]").length, JSON.stringify([1]));
for (const holder of holders) {
  if (holder === Date) holder.now = () => 1;
  if (holder === Math) holder.random = () => 2;
  if (holder === JSON) {
    holder.parse = () => 3;
    holder.stringify = () => 4;
  }
}
print(Date.now(), Math.random(), JSON.parse("[1]"), JSON.stringify([1]));
