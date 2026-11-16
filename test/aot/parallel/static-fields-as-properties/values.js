export function plain(value) {
  return typeof value === "object" && value !== null ? "object" : value;
}
export class Shared {
  static word = undefined;
}
export function change(holder, turn) {
  holder.word = [[1], [2]];
}
export function construct(callback) {
  const ends = [];
  for (const given of [[new Proxy({}, {})], [], [1, 2, 3], [{}]]) {
    try {
      ends.push(String(new callback(...given)));
    } catch (error) {
      ends.push("threw");
    }
  }
  return ends.join();
}
