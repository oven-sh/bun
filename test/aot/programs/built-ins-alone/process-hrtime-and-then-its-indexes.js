const held = process.hrtime();
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value;
}
for (let index = 0; index < held.length; index++) console.log(show(held[index]));
