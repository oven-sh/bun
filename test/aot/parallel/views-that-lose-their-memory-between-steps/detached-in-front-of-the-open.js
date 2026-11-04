function take(buffer) {
  const view = new Uint8Array(buffer);
  buffer.transfer();
  const [a, b = 7] = view;
  return a + "," + b;
}
function walk(buffer) {
  const view = new Uint8Array(buffer);
  buffer.transfer();
  let turns = 0;
  for (const value of view) turns += 1 + value;
  return turns;
}
for (let i = 0; i < 3; i++) {
  try { console.log(take(new ArrayBuffer(1))); } catch (e) { console.log(e.constructor.name + ": " + e.message); }
  try { console.log(walk(new ArrayBuffer(1))); } catch (e) { console.log(e.constructor.name + ": " + e.message); }
}
