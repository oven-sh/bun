// Literals with different members of one type meet in one place, are copied, frozen, deleted from and compared.
type Style = { color?: string; size?: number; bold?: boolean; margin?: number; padding?: number; border?: string };

function merge(...styles: Style[]): Style {
  let merged: Style = {};
  for (const style of styles) merged = { ...merged, ...style };
  return merged;
}

function pick(i: number): Style {
  switch (i % 6) {
    case 0: return { color: "red" };
    case 1: return { size: i };
    case 2: return { bold: i % 4 === 2 };
    case 3: return { margin: i / 2, padding: i };
    case 4: return { border: "1px", color: "blue", size: 1 };
    default: return {};
  }
}

function show(style: Style): string {
  return `${style.color}|${style.size}|${style.bold}|${style.margin}|${style.padding}|${style.border}|${Object.keys(style)}`;
}

const all: Style[] = [];
for (let i = 0; i < 24; i++) all.push(pick(i));
console.log(all.map(show).join("\n"));
console.log(show(merge(...all)));

const frozen = Object.freeze(pick(3));
try {
  "use strict";
  (frozen as Record<string, unknown>)["color"] = "no";
} catch (error) {
  console.log((error as Error).constructor.name);
}
console.log(show(frozen), Object.isFrozen(frozen));

const emptied = pick(4);
delete emptied.color;
delete emptied.margin;
console.log(show(emptied));

const map = new Map<Style, number>();
for (const style of all) map.set(style, (style.size ?? 0) + (style.padding ?? 0));
console.log([...map.values()].join(","));

class Box {
  style: Style = {};
  other: Style = { bold: true };
  constructor(public given: Style = { size: 3 }) {}
  total(): number {
    return (this.style.size ?? 1) + (this.other.size ?? 2) + (this.given.size ?? 4) + (this.given.margin ?? 8);
  }
}
console.log(new Box().total(), new Box({}).total(), new Box({ margin: 1 }).total(), new Box(pick(1)).total());

function generic<T extends Style>(style: T): T & { seen: boolean } {
  return { ...style, seen: style.bold ?? false };
}
console.log(JSON.stringify(generic({ bold: true })), JSON.stringify(generic({ size: 2 })), JSON.stringify(generic({})));
console.log(JSON.stringify(all.filter(style => style.size !== undefined).map(style => style.size)));
console.log(structuredClone(pick(3)), { ...pick(4) });
