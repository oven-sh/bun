declare const process: { argv: string[]; exit(code: number): never };
declare const console: { log(...values: any[]): void };
type Styles = {
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  flexGrow?: number;
  flexShrink?: number;
  margin?: number;
  padding?: number;
  overflow?: "visible" | "hidden";
  overflowX?: "visible" | "hidden";
  overflowY?: "visible" | "hidden";
};
function box(style: Styles): Styles {
  return {
    flexWrap: "nowrap",
    flexDirection: "row",
    flexGrow: 0,
    flexShrink: 1,
    ...style,
    overflowX: style.overflowX ?? style.overflow ?? "visible",
    overflowY: style.overflowY ?? style.overflow ?? "visible",
  };
}
const rounds = Number(process.argv[2]);
const given: Styles[] = [{ margin: 1 }, { flexDirection: "column", padding: 2 }, { overflow: "hidden" }, {}];
let sum = 0;
for (let i = 0; i < rounds; i++) {
  const made = box(given[i % given.length]!);
  sum += made.overflowX!.length + made.flexDirection!.length + (made.margin ?? 0);
}
console.log(sum);
process.exit(0);
