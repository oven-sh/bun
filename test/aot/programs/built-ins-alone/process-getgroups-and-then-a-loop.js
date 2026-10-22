const held = process.getgroups();
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value;
}
for (const value of held) console.log(show(value));
