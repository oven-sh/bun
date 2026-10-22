// One declared type with optional fields is many layouts: literals give every combination of the fields, in the declared order and in others, some give `undefined` outright. One set of reads, stores and tests serves them all.
interface Style {
  color?: string;
  width?: number;
  bold?: boolean;
  parent?: Style;
}

function colorOf(style: Style): string | undefined {
  return style.color;
}
function widthOf(style: Style): number | undefined {
  return style.width;
}
function boldOf(style: Style): boolean | undefined {
  return style.bold;
}
function parentColor(style: Style): string | undefined {
  return style.parent?.color;
}
function widthOrDefault(style: Style): number {
  return style.width ?? -1;
}
function setWidth(style: Style, width: number | undefined): void {
  style.width = width;
}
function setColor(style: Style, color: string): void {
  style.color = color;
}
function present(style: Style): string {
  return ("color" in style ? "c" : "-") + ("width" in style ? "w" : "-") + ("bold" in style ? "b" : "-") + ("parent" in style ? "p" : "-");
}
function look(mark: string, style: Style): void {
  const before = [colorOf(style), widthOf(style), boldOf(style), parentColor(style), widthOrDefault(style), present(style), Object.keys(style).join("")].map(String).join(" ");
  setWidth(style, 9);
  setColor(style, "set");
  const stored = [colorOf(style), widthOf(style), present(style), Object.keys(style).join("+")].map(String).join(" ");
  setWidth(style, undefined);
  console.log(mark + ":", before, "|", stored, "|", String(widthOf(style)), widthOrDefault(style), present(style), JSON.stringify(style));
}

const root: Style = { color: "root" };

look("none", {});
look("c", { color: "c" });
look("w", { width: 1 });
look("b", { bold: true });
look("p", { parent: root });
look("cw", { color: "c", width: 1 });
look("wc", { width: 1, color: "c" });
look("cb", { color: "c", bold: false });
look("bc", { bold: false, color: "c" });
look("wb", { width: 1.5, bold: true });
look("cp", { color: "c", parent: root });
look("cwb", { color: "c", width: 1, bold: true });
look("bwc", { bold: true, width: 1, color: "c" });
look("wbp", { width: 0, bold: false, parent: {} });
look("cwbp", { color: "c", width: 1, bold: true, parent: root });
look("pbwc", { parent: { parent: root }, bold: true, width: 1, color: "c" });
look("undefined outright", { color: undefined, width: undefined, bold: undefined, parent: undefined });
look("some undefined", { color: "c", width: undefined });
look("none", {});
look("cwbp", { color: "c", width: 1, bold: true, parent: root });

function build(withColor: boolean, withWidth: boolean, withBold: boolean): Style {
  const style: Style = {};
  if (withBold) style.bold = true;
  if (withColor) style.color = "built";
  if (withWidth) style.width = 3;
  return style;
}
look("built ---", build(false, false, false));
look("built c--", build(true, false, false));
look("built -w-", build(false, true, false));
look("built cw-", build(true, true, false));
look("built --b", build(false, false, true));
look("built cwb", build(true, true, true));

function conditional(flag: boolean): Style {
  return { ...(flag ? { color: "conditional" } : {}), width: 4, ...(flag ? {} : { bold: true }) };
}
look("conditional, true", conditional(true));
look("conditional, false", conditional(false));
console.log(JSON.stringify(root));

export {};
