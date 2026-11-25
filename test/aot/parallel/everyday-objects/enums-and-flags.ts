// Enums of numbers and of texts, turned around and combined
enum Level { Low = 1, Middle, High = 10 }
enum Color { Red = "r", Blue = "b" }
const enum Bit { A = 1, B = 1 << 1, C = A | B }
function show(level: Level, color: Color): string {
  const names = Object.keys(Level).filter(key => isNaN(Number(key)));
  return [Level[level], level + 1, names.join("+"), color, Object.values(Color).indexOf(color), Bit.C & level, level === Level.High].join();
}
console.log(show(Level.Low, Color.Red));
console.log(show(Level.High, Color.Blue));
console.log(show(Level.Middle, Color.Blue));
