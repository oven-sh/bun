export function stored(point) {
  point.x = 10;
  return point.x;
}
export function copied(point) {
  return Object.assign({}, point);
}
