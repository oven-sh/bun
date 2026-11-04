// The fields of parameter properties come in front of every other field, whatever stands in front of the constructor.
class Early { first = 1; constructor(public given: number, public other = 0) {} last = 2; }
class Late { constructor(public given: number) { this.added = 4; } added: number; tail = 3; }
class Above { top = "a"; }
class Under extends Above { mid = "b"; constructor(public low: string) { super(); } end = "c"; }
class Twice { constructor(public same: number, public again: number) { this.again = same; this.same = again; } }
const evaluate = (text: string): any => (0, eval)("(function (Above) { return (" + text + "); })")(Above);
for (const Made of [Early, Late, Under, Twice]) {
  const [own, again] = [new (Made as any)(7, 8), new (evaluate(String(Made)))(7, 8)];
  console.log(Made.name, Object.keys(own).join(), Object.keys(again).join(), JSON.stringify(own) === JSON.stringify(again));
}
