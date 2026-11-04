const unseen = (0, eval)("(x) => x") as <T>(x: T) => T;
abstract class Figure { abstract describe(text: string, n: number): string; }
class Round extends Figure { describe(text: string, n: number) { return "r" + text + n; } }
class Square extends Figure { describe(text: string, n: number) { return "s" + text + n; } }
class Flat extends Figure { describe(text: string, n: number) { return "f" + n + text; } }
const figures: Figure[] = [new Round(), new Square(), new Flat()];
function gather(count: number): string {
  const kept: string[] = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    const figure = figures[i % 3];
    const got = figure.describe(line, i);
    line += "k" + i;
    kept.push(got);
  }
  return line + "/" + kept.join("|");
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = gather(unseen(4));
console.log(last);
console.log(gather(unseen(7)));
