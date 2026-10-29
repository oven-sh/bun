// `"padding" in style`: a function asks a record of options which of them it has.
declare const process: { argv: string[] };
declare const console: { log(...values: any[]): void };
type Styles = { padding?: number; paddingX?: number; paddingY?: number; paddingLeft?: number; paddingRight?: number; margin?: number; gap?: number };
class Target { total = 0; set(edge: number, value: number | undefined): void { this.total += edge * (value ?? 1); } }
function applyPadding(target: Target, style: Styles): void {
  if ("padding" in style) target.set(1, style.padding);
  if ("paddingX" in style) target.set(2, style.paddingX);
  if ("paddingY" in style) target.set(3, style.paddingY);
  if ("paddingLeft" in style) target.set(4, style.paddingLeft);
  if ("paddingRight" in style) target.set(5, style.paddingRight);
}
const given: Styles[] = [{}, { padding: 1 }, { paddingX: 2, margin: 1 }, { gap: 1, paddingRight: undefined }];
{ (globalThis as any).kept = [applyPadding, given]; const somebody: any = (globalThis as any)[JSON.parse('"somebody"')] ?? {}; somebody[JSON.parse('"something"')] = 1; Object.defineProperty(somebody, JSON.parse('"other"'), { get() { return 1; }, configurable: true }); }
const target = new Target();
const rounds = Number(process.argv[2] ?? 1000);
for (let i = 0; i < rounds; i++) applyPadding(target, given[i & 3]!);
const inherits: Styles = Object.create({ paddingY: 7 });
applyPadding(target, inherits);
console.log(target.total);
