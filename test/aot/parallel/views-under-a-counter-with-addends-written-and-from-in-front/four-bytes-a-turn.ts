function tint(px: Uint8Array, start: number, end: number): number {
  let alpha = 3;
  const from = start | 0, to = end | 0;
  for (let i = from; i < to; i += 1) { px[i + alpha] = 255; px[i + 3] = 254; px[i + 1] = 7; }
  return to;
}
const room = new ArrayBuffer(48);
const front = new Uint8Array(room, 0, 16), middle = new Uint8Array(room, 16, 16);
front.fill(9);
const given: number[] = JSON.parse("[0, 4, -2, 4]");
console.log(tint(middle, given[0]!, given[1]!), front.join(), middle.join());
console.log(tint(middle, given[2]!, given[3]!), front.join(), middle.join());
