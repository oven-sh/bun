// An instance of a class, and one of a class below it, pass for a written type with the same members.
type Point = { x: number; y: number };
class Spot {
  y = 2;
  x = 1;
}
class Marked extends Spot {
  mark = "m";
  #hidden = 1;
  peek() {
    return this.#hidden;
  }
}
function list(p: Point) {
  return Object.values(p).join() + "|" + Object.keys(p).join();
}
function deed() {
  return list(new Spot()) + " " + list(new Marked());
}
console.log(list({ x: 1, y: 2 }), deed());
let all = "";
for (let i = 0; i < 20; i++) all += list({ x: i, y: 1 }) + " " + deed() + " ";
console.log(all, new Marked().peek());
