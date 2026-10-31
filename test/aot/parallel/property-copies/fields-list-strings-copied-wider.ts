// Fields whose types list strings, copied between layouts whose lists are equal, wider, narrower and disjoint.
type Direction = "row" | "column";
type WideDirection = Direction | "row-reverse" | "column-reverse";
type Wrap = "wrap" | "nowrap";
type Narrow = { direction?: Direction; wrap?: Wrap; gap?: number; name?: string };
type Wide = { direction?: WideDirection; wrap?: Wrap | undefined; gap?: number; name?: string; extra?: boolean };
type Loose = { direction?: string; wrap?: string; gap?: number; name?: string; loose: true };
type Other = { direction?: "up" | "down"; wrap?: Wrap; gap?: number; other: 1 };

const directions: Direction[] = ["row", "column"];
const wideDirections: WideDirection[] = ["row", "column", "row-reverse", "column-reverse"];
const wraps: Wrap[] = ["wrap", "nowrap"];

function narrow(index: number): Narrow {
  const made: Narrow = { direction: directions[index & 1] };
  if (index & 2) made.wrap = wraps[(index >> 2) & 1];
  if (index & 8) made.gap = index;
  if (index % 3 === 0) made.name = "n" + index;
  return made;
}
function wide(index: number): Wide {
  return { direction: wideDirections[index & 3], wrap: index & 4 ? wraps[index & 1] : undefined, extra: (index & 1) === 0 };
}
const built = ["ro", "w"].join("");

function toWide(value: Narrow): Wide { return { ...value, extra: true }; }
function toLoose(value: Narrow): Loose { return { ...value, loose: true }; }
function wideToLoose(value: Wide): Loose { return { ...value, loose: true }; }
function toNarrow(value: Wide): Narrow { const { extra, ...rest } = value; return { ...(rest as Narrow) }; }
function looseToNarrow(value: Loose): Narrow { const { loose, ...rest } = value; return { ...(rest as Narrow) }; }
function toOther(value: Narrow): Other { return { ...(value as unknown as Other), other: 1 }; }

function show(label: string, value: object) {
  console.log(label, JSON.stringify(value), Object.keys(value).join(","));
}
let sum = 0;
const rounds = Number(process.argv[2] ?? 2);
for (let round = 0; round < rounds; round++) {
  for (let index = 0; index < 16; index++) {
    const a = narrow(index), b = wide(index);
    const results: [string, object][] = [
      ["toWide", toWide(a)], ["toLoose", toLoose(a)], ["wideToLoose", wideToLoose(b)], ["toNarrow", toNarrow(b)],
      ["looseToNarrow", looseToNarrow({ direction: index & 1 ? built : "sideways" + index, wrap: wraps[index & 1], loose: true })],
      ["toOther", toOther(a)], ["back", toNarrow(toWide(a))],
    ];
    for (const [label, value] of results) {
      sum += Object.keys(value).length + String((value as Narrow).direction).length;
      if (round < 2) show(round + " " + index + " " + label, value);
    }
  }
}
console.log(sum);
