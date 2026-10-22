const held = process.resourceUsage();
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value;
}
for (const [key, value] of Object.entries(held)) console.log(key, show(value));
