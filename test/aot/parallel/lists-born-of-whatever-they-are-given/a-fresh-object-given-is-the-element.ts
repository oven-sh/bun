// What is given and is no number becomes the one element: the list holds the object itself, so a store through the list is seen through the name, and the other way round.
function throughTheList(seed: number, pick: any) {
  const point = { x: seed, y: seed + 1 };
  const given: any = pick ? point : seed;
  const list = new Array(given);
  if (pick) list[0].x = 40;
  return point.x + point.y + list.length;
}
function throughTheName(seed: number, pick: any) {
  const point = { x: seed };
  const given: any = pick ? point : seed;
  const list = Array(given);
  point.x = 70;
  return pick ? list[0].x : list.length;
}
function keptBehindACall(seed: number, pick: any, sink: (list: any[]) => void) {
  const point = { x: seed };
  const given: any = pick ? point : seed;
  sink(new Array(given));
  return point.x;
}
let said = 0;
for (let turn = 0; turn < 300; turn++) {
  said += throughTheList(turn & 7, turn & 1) + throughTheName(turn & 7, turn & 1);
  said += keptBehindACall(turn & 7, turn & 1, list => { if (typeof list[0] === "object") list[0].x = 500; });
}
console.log(said, throughTheList(3, 1), throughTheList(3, 0), throughTheName(3, 1), throughTheName(3, 0));
