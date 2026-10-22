const subject = performance;
const held = subject.toJSON();
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value;
}
for (const value of Object.values(held)) console.log(show(value));
