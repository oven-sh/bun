function from(start: any, limit: any) {
  while (start < limit) {
    if (start % 7 === 0) break;
    start++;
  }
  return start;
}
function count(start: any, limit: any) {
  let at = from(start, limit);
  let turns = 0;
  while (at < limit) {
    turns++;
    at++;
  }
  return String(at) + ":" + String(turns);
}
const limits: number[] = JSON.parse("[2147483650, 10, 2147483647, 0]");
console.log(count(2147483640, limits[0]), count(undefined, limits[1]), count(3, limits[1]), count(2147483645, limits[2]), count(-3, limits[3]));
