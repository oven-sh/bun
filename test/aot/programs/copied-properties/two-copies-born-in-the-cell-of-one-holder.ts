type Size = { wide: number; high: number };
type Place = { left: number; top: number };
type Box = { size: Size; place: Place; name: string };
function grow(box: Box, by: number): Box {
  return { size: { ...box.size, wide: box.size.wide + by }, place: { ...box.place, top: box.place.top - by }, name: box.name + by };
}
let box: Box = { size: { wide: 1, high: 2 }, place: { left: 3, top: 4 }, name: "b" };
const all: Box[] = [box];
for (let round = 1; round < 40; round++) {
  box = grow(box, round % 3);
  all.push(box);
}
console.log(JSON.stringify(all[39]), all.filter(each => each.size.high !== 2 || each.place.left !== 3).length);
console.log(all.map(each => each.size.wide + ":" + each.place.top).join(" "));
