// `count` is copied in line with a predicate that compares a field with what the closure has captured: a text that is in sight where the closure is made.
interface Named { name: string }
type Kind = "a" | "b" | "c";
interface Row { tag: Named | Kind; id: number }
function count<T>(list: T[], predicate: (item: T) => unknown): number { let n = 0; for (const item of list) n += +!!predicate(item); return n; }
const hidden = (x: unknown): any => [x][JSON.parse("0")];
function tell(rows: Row[]): string {
  const of = (kind: Kind) => count(rows, ({ tag }) => tag === kind);
  return [of("a"), of("b"), of("c")].join(" ");
}
console.log(tell(hidden([{ tag: "a", id: 1 }, { tag: "b", id: 2 }, { tag: "a", id: 3 }, { tag: { name: "n" }, id: 4 }])));
console.log(tell([{ tag: { name: "m" }, id: 1 }]));
