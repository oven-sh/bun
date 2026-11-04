// an object that nobody else holds is handed to a function, which collects and then reads it once: across the collection it lies in the frame alone
function keep(object, other) {
  Bun.gc(true);
  return object;
}
function make(number) {
  return { name: "kept " + String(number), list: [number, number + 1] };
}
function deed(number) {
  const kept = keep(make(number), number);
  return kept.name + " " + kept.list.join();
}
console.log(deed(1));
for (let turn = 0; turn < 20; turn++) {
  if (deed(turn) !== "kept " + String(turn) + " " + String(turn) + "," + String(turn + 1)) console.log("differs at " + String(turn));
}
console.log(deed(2));
