// A component takes some of its props by name and the rest as one object, and reads many optional fields of that object. Most callers leave most of them out.
declare const process: { argv: string[] };
declare const console: { log(...values: any[]): void };
type Props = { children: string; onClick?: () => void; onFocus?: () => void; onBlur?: () => void; tabIndex?: number; autoFocus?: boolean; margin?: number; marginX?: number; marginY?: number; padding?: number; paddingX?: number; paddingY?: number; gap?: number; rowGap?: number; wrap?: "wrap" | "nowrap" };
let warnings = 0;
function ifNotInteger(value: number | undefined, name: string): void { if (value !== undefined && !Number.isInteger(value)) warnings += name.length; }
function box(props: Props): number {
  const { children, onClick, onFocus, onBlur, tabIndex, autoFocus, ...style } = props;
  ifNotInteger(style.margin, "margin");
  ifNotInteger(style.marginX, "marginX");
  ifNotInteger(style.marginY, "marginY");
  ifNotInteger(style.padding, "padding");
  ifNotInteger(style.paddingX, "paddingX");
  ifNotInteger(style.paddingY, "paddingY");
  ifNotInteger(style.gap, "gap");
  ifNotInteger(style.rowGap, "rowGap");
  style.wrap ??= "nowrap";
  return children.length + (onClick ? 1 : 0) + (onFocus ? 2 : 0) + (onBlur ? 4 : 0) + (tabIndex ?? 0) + (autoFocus ? 8 : 0) + style.wrap.length + (style.margin ?? 0);
}
const given: Props[] = [{ children: "a" }, { children: "bc", margin: 1 }, { padding: 2, children: "d" }, { children: "e", gap: 3, wrap: "wrap" }];
{ (globalThis as any).kept = [box, given]; const somebody: any = (globalThis as any)[JSON.parse('"somebody"')] ?? {}; somebody[JSON.parse('"something"')] = 1; Object.defineProperty(somebody, JSON.parse('"other"'), { get() { return 1; }, configurable: true }); }
const rounds = Number(process.argv[2]);
let sum = 0;
for (let i = 0; i < rounds; i++) sum += box(given[i & 3]!);
console.log(sum, warnings);
