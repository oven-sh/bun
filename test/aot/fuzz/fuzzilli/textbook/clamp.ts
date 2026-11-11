function clamped(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
function all(list: number[]): number[] {
  const out = new Array<number>(list.length);
  for (let i = 0; i < list.length; i++) out[i] = clamped(list[i], 0, 255);
  return out;
}
console.log(all(JSON.parse("[-5,0,128,255,300]")).join());
