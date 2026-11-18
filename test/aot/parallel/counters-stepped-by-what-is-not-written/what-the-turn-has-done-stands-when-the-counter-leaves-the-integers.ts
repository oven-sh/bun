// A turn writes into a list, a field and a view and then steps over the end: no turn runs twice, none is left out.
const shown: string[] = [];
function show(value: unknown): void {
  shown.push(Object.is(value, -0) ? "-0" : String(value));
}
class Tally { turns = 0; last = 0.5; }
function run(from: number, step: number, limit: number): string {
  const tally = new Tally(), places: number[] = [], marks = new Float64Array(8);
  for (let at = from; at < limit; at += step | 0) {
    if (tally.turns >= 8) break;
    places.push(at);
    marks[tally.turns] = at;
    tally.turns++;
    tally.last = at;
  }
  return [tally.turns, tally.last, places.join("/"), marks.join("/")].join(" ");
}
show(run(0, 3, 10));
show(run(2147483000, 300, 2147485000));
show(run(2147483646, 1, 2147483652));
show(run(2147483647, 2147483647, 9000000000));
show(run(-2147483648, 2147483647, 5000000000));
show(run(1.5, 2, 9));
show(run(-0, 1, 2));
console.log(shown.join(" "));
