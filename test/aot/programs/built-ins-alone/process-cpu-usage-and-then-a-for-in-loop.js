const held = process.cpuUsage();
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value;
}
for (const key in held) console.log(key, show(held[key]));
