// The argument of a call inside a try is tested for its type, and the handler of the try is handed the same value under two other names.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
function use4(text: string, round: number): string {
  const many: string[] = [text, text];
  const loose = many as any;
  function* steps(): Generator<string, void, unknown> {
    const before = new Point(round, 8);
    yield "";
    const answer = (() => {
      try {
        return (1.5).toFixed(loose[0]);
      } catch (error) {}
    })();
    yield String(answer) + before.y;
  }
  return [...steps()].join("");
}
let out = "";
for (let round = 0; round < 3; round++) out += use4(JSON.parse('"1"'), round);
console.log(out);
