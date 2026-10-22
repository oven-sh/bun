const held = process.resourceUsage();
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value;
}
const copy = Object.assign({}, held);
for (const key in copy) console.log(key, show(copy[key]));
