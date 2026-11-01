// What at, pop and shift hand out of a list that holds a few texts written in the program is compared, switched on, joined, measured, used as a key and printed as the same text read by its index is.
type Color = "red" | "green" | "blue" | "black";
const colors: Color[] = ["red", "green", "blue", "black"];
const weights: Record<Color, number> = { red: 1, green: 20, blue: 300, black: 4000 };
function rank(color: Color | undefined): number {
  switch (color) {
    case "red":
      return 1;
    case "green":
      return 2;
    case "blue":
      return 3;
    case "black":
      return 4;
    default:
      return 0;
  }
}
function describe(color: Color | undefined): string {
  const parts = [
    String(color),
    typeof color,
    rank(color),
    color === "blue",
    color !== "red",
    color == undefined,
    (color ?? "none").length,
    color + "!",
    `${color}`,
  ];
  if (color !== undefined)
    parts.push(
      weights[color],
      color in weights,
      color < "c",
      color.toUpperCase(),
      color.charCodeAt(0),
      colors.indexOf(color),
      colors.includes(color),
      [color, color].join("-"),
    );
  return parts.join(" ");
}
const out: string[] = [];
for (let round = 0; round < 3; round++) {
  for (let k = -5; k <= 5; k++)
    out.push("at " + k + ": " + describe(colors.at(k)) + " | " + describe(colors[k < 0 ? colors.length + k : k]));
  const stack = colors.slice(),
    queue = [...colors];
  for (let k = 0; k < 5; k++) out.push("pop " + describe(stack.pop()) + " | shift " + describe(queue.shift()));
  const seen = new Set<Color | undefined>(),
    counts = new Map<Color | undefined, number>();
  for (let k = 0; k < 9; k++) {
    const color = colors.at(k % 5);
    seen.add(color);
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  out.push([...seen].join() + " " + [...counts].join(";"));
  const made: Color[] = [];
  made.push(("bl" + (round ? "ue" : "ack")) as Color);
  made.push("red");
  out.push(
    describe(made.at(0)) +
      " | " +
      describe(made.at(-1)) +
      " | " +
      describe(made.shift()) +
      " | " +
      describe(made.pop()) +
      " | " +
      describe(made.pop()),
  );
}
console.log(out.join("\n"));
