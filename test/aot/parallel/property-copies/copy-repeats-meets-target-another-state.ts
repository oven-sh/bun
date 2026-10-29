// A copy between two shapes is repeated many times, so whatever the run time has learned from the earlier copies is in use, and then the same two shapes meet
// with the target in another state: a member is there already, a member of the source holds undefined or is gone, the target is frozen, has foreign names, or is listed.
type Style = { width?: number | string; height?: number; gap?: number; color?: string; label?: string | undefined; nested?: { deep: number }; ratio?: number; on?: boolean };
type Props = Style & { children?: unknown; id?: number };

const lines: string[] = [];
const show = (what: string, value: unknown): void => { lines.push(what + " " + JSON.stringify(value) + " " + (value && typeof value === "object" ? Object.keys(value).join(",") : "")); };
const call = <A, R>(f: (argument: A) => R, argument: A): R => f(argument);

const sources: (() => Props)[] = [
  () => ({ width: 1, children: "a" }),
  () => ({ width: "100%", height: 2, children: "b" }),
  () => ({ gap: 1, color: "red", id: 3 }),
  () => ({ color: "blue", gap: 2, nested: { deep: 1 } }),
  () => ({ label: undefined, ratio: 0.5 }),
  () => ({ ratio: 2, label: "l", on: true }),
  () => ({ on: false, height: -0, width: 1.5 }),
  () => ({}),
  () => ({ id: 9, children: null, nested: { deep: 2 }, height: 2147483648 }),
];

function takeApart({ children, id, ...style }: Props): Style { return style; }
function copy(style: Style): Style { return { ...style }; }
function behindMembers(style: Style): Style { return { width: 7, color: "own", ...style }; }
function beforeMembers(style: Style): Style { return { ...style, width: 7, color: "own" }; }
function twice(first: Style, second: Style): Style { return { ...first, ...second }; }
function assignTo(target: Style, style: Style): Style { return Object.assign(target, style); }

function round(turn: number, isShown: boolean): void {
  for (let i = 0; i < sources.length; i++) {
    const make = sources[i]!;
    const style = call(takeApart, make());
    const results: [string, unknown][] = [
      ["rest", style],
      ["copy", call(copy, style)],
      ["behind", call(behindMembers, style)],
      ["before", call(beforeMembers, style)],
      ["twice", twice(style, call(takeApart, sources[(i + turn) % sources.length]!()))],
      ["assign to empty", assignTo({}, style)],
      ["assign to filled", assignTo({ height: 5, label: "kept" }, style)],
      ["assign to the same keys", assignTo(call(copy, style), call(takeApart, make()))],
    ];
    if (isShown) {
      for (const [what, value] of results) show(turn + " " + i + " " + what, value);
    }
  }
}
for (let turn = 0; turn < 300; turn++) round(turn, turn < 2 || turn === 299);

// The shapes have met three hundred times. Now the targets differ.
for (let i = 0; i < sources.length; i++) {
  const style = call(takeApart, sources[i]!());
  const withOneMember: Style = {};
  withOneMember.gap = 40;
  show(i + " one member first", assignTo(withOneMember, style));
  const withDeleted: Style = { width: 1, gap: 2 };
  delete withDeleted.width;
  show(i + " one member deleted", assignTo(withDeleted, style));
  const withForeignName: Style = {};
  (withForeignName as Record<string, unknown>)["foreign"] = i;
  show(i + " a foreign name first", assignTo(withForeignName, style));
  const ofOtherType: Style = {};
  (ofOtherType as Record<string, unknown>)["height"] = "tall";
  show(i + " a member of another type first", assignTo(ofOtherType, style));
  const frozen = Object.freeze<Style>({});
  try {
    show(i + " frozen", assignTo(frozen, style));
  } catch (error) {
    show(i + " frozen throws", (error as Error).constructor.name);
  }
  const sealed = Object.seal<Style>({ gap: 0 });
  try {
    show(i + " sealed", assignTo(sealed, style));
  } catch (error) {
    show(i + " sealed throws", (error as Error).constructor.name);
  }
}

// And the sources differ: same keys in the same order, other values in them.
for (let turn = 0; turn < 3; turn++) {
  const changed: Props = { gap: 1, color: "red", id: 3 };
  if (turn === 1) changed.gap = undefined;
  if (turn === 2) (changed as Record<string, unknown>)["color"] = 12;
  show(turn + " changed source", call(copy, call(takeApart, changed)));
  const emptied: Props = { width: "100%", height: 2, children: "b" };
  if (turn === 1) delete emptied.height;
  if (turn === 2) { delete emptied.width; emptied.width = 3; }
  show(turn + " emptied source", call(behindMembers, call(takeApart, emptied)));
}
console.log(lines.join("\n"));
