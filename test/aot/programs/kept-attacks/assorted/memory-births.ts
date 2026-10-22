// Assorted: memory births. It prints what plain Bun prints.
type Style = { color?: string; width?: number; bold?: boolean; margin?: number; label?: string };
type Props = { id: string; style?: Style; label?: string };

const styles: Style[] = [{ color: "a", width: 1 }, { bold: true }, { margin: 2, label: "x" }, { width: 3 }, { color: "white", margin: 1 }, {}];
const props: Props[] = [{ id: "x", label: "l" }, { id: "y", style: styles[0] }, { id: "z" }];

function merge(base: Style, extra: Style): Style {
  return { ...base, ...extra };
}
function withId(p: Props, id: string): Props {
  return { ...p, id };
}
function defaults(s: Style): Style {
  return { color: "black", ...s, bold: true };
}
function rest(p: Props) {
  const { id, ...others } = p;
  return others;
}
function grow(n: number): Style {
  const s: Style = {};
  s.color = "red";
  if (n & 1) s.width = n;
  s.bold = true;
  return s;
}
const kept: object[] = [];
let sum = 0;
const keys: string[] = [];
for (let i = 0; i < 3000; i++) {
  const a = merge(styles[i % 6], styles[(i * 5 + 1) % 6]);
  const b = withId(props[i % 3], "y" + (i & 3));
  const c = defaults(styles[(i + 2) % 6]);
  const d = rest(props[(i + 1) % 3]);
  const e = grow(i);
  kept[i & 63] = i & 1 ? a : i & 2 ? b : i & 4 ? c : i & 8 ? d : e;
  styles[6 + (i & 7)] = i & 16 ? a : c;
  sum += (a.width ?? 0) + b.id.length + (c.margin ?? 0) + (e.width ?? 0) + (d.label ? 1 : 0);
  if (i < 6) keys.push(Object.keys(a).join(), Object.keys(b).join(), Object.keys(c).join(), Object.keys(d).join(), Object.keys(e).join());
}
console.log(sum, kept.length, keys.join(" | "));
