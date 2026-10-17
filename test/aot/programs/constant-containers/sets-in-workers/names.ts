export const COLORS = new Set(["red", "green", "blue", "cyan", "magenta", "yellow", "black", "white", "orange", "purple"]);
export const UNTOUCHED = new Set(["north", "east", "south", "west"]);

export function describe(who: string): string {
  return who + ": " + COLORS.size + " " + [...COLORS].join() + " | " + ["red", "pink", "gray", "teal", "blue"].map(name => COLORS.has(name)).join() + " | " + UNTOUCHED.has("east") + " " + UNTOUCHED.has("up") + " " + UNTOUCHED.size;
}

export function change(number: number) {
  if (number === 0) COLORS.add("pink");
  if (number === 1) COLORS.delete("red");
  if (number === 2) COLORS.clear();
  if (number === 2) COLORS.add("teal");
}
