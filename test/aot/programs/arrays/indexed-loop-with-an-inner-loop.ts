// An indexed loop over an array parameter whose body holds an inner loop over the same array and a write. The tests of the outer read are placed before the loop, its body is copied, and both copies enter the inner loop: the array is one object on every path, with flow results off too.
type Item = { kind: string; id: number };

function isMarked(item: Item): boolean {
  return item.kind === "marked";
}

function collapse(items: Item[]): Item[] {
  const result: Item[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i]!;
    if (isMarked(item)) {
      let count = 0;
      while (i < items.length && isMarked(items[i]!)) {
        count++;
        i++;
      }
      if (count === 1) {
        result.push(item);
      } else {
        result.push({ kind: "batch", id: count });
      }
    } else {
      result.push(item);
      i++;
    }
  }
  return result;
}

function shift(lines: string[], start: number, end: number, direction: ">" | "<"): void {
  const indent = "  ";
  for (let i = start; i <= end; i++) {
    const line = lines[i] ?? "";
    if (line === "") {
      continue;
    }
    if (direction === ">") {
      lines[i] = indent + line;
    } else if (line.startsWith(indent)) {
      lines[i] = line.slice(indent.length);
    } else if (line.startsWith("\t")) {
      lines[i] = line.slice(1);
    } else {
      let index = 0;
      while (index < line.length && index < indent.length && /\s/.test(line[index]!)) {
        index++;
      }
      lines[i] = line.slice(index);
    }
  }
}

const items: Item[] = [
  { kind: "plain", id: 1 },
  { kind: "marked", id: 2 },
  { kind: "marked", id: 3 },
  { kind: "plain", id: 4 },
  { kind: "marked", id: 5 },
];
console.log(JSON.stringify(collapse(items)));
const lines = ["a", "  b", "\tc", " d", ""];
shift(lines, 0, 5, "<");
console.log(JSON.stringify(lines));
shift(lines, 0, 4, ">");
console.log(JSON.stringify(lines));
