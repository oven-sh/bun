// Native members of requests: stores by name into fields typed as string literals. It prints what plain Bun prints.
declare const process: { argv: string[] };
declare const console: { log(...values: unknown[]): void };
type Styles = {
  overflowX?: "visible" | "hidden" | "scroll";
  overflowY?: "visible" | "hidden" | "scroll";
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  width?: number;
};
const unseen = new Function("x", "return x") as <T>(value: T) => any;
function fill(target: any, source: any): void {
  target.overflowX = source.overflowX;
  target.overflowY = source.overflowY;
  target.flexWrap = source.flexWrap;
  target.flexDirection = source.flexDirection;
}
function describe(styles: Styles): number {
  return (styles.overflowX === "hidden" ? 1 : 0) + (styles.overflowY === "scroll" ? 2 : 0) + (styles.flexWrap === "wrap" ? 4 : 0) + (styles.flexDirection === "column" ? 8 : 0);
}
const rounds = Number(process.argv[2]);
const source = unseen({ overflowX: "hidden", overflowY: "scroll", flexWrap: "wrap", flexDirection: "column" });
let total = 0;
for (let round = 0; round < rounds; round++) {
  const styles: Styles = { width: round };
  fill(unseen(styles), source);
  total += describe(styles);
}
console.log(total);
