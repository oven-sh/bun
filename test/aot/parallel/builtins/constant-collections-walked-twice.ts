// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const show = (value: unknown): string =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label: string, probe: () => unknown): void => {
  let text: string;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + (error as Error).constructor.name;
  }
  console.log(label + ": " + text);
};
const names = new Set(["alpha", "beta", "gamma", "delta"]);
const ages = new Map([
  ["ann", 31],
  ["bob", 27],
  ["cy", 45],
]);
function walkTwice(set: Set<string>): string {
  let seen = "";
  for (const name of set) seen += name + " ";
  for (const name of set) seen += name.length;
  set.forEach(name => {
    seen += " " + name;
  });
  set.forEach((name, again, whole) => {
    seen += name === again && whole === set ? "=" : "!";
  });
  return seen;
}
function walkNested(set: Set<string>): string[] {
  const pairs: string[] = [];
  for (const outer of set) for (const inner of set) if (outer < inner) pairs.push(outer[0] + inner[0]);
  set.forEach(outer =>
    set.forEach(inner => {
      if (outer > inner) pairs.push(outer[0] + inner[0]);
    }),
  );
  return pairs;
}
function walkMap(map: Map<string, number>): (string | number)[] {
  const seen: (string | number)[] = [];
  for (const [name, age] of map) seen.push(name, age);
  for (const [name, age] of map.entries()) seen.push(name + age);
  for (const age of map.values()) seen.push(age);
  for (const name of map.keys()) seen.push(name);
  map.forEach((age, name) => {
    seen.push(name.length + age);
  });
  return seen;
}
function reportAll(when: string): void {
  report(when + ": set twice", () => walkTwice(names));
  report(when + ": set nested", () => walkNested(names));
  report(when + ": map", () => walkMap(ages));
  report(when + ": spread", () => [[...names], names.size, [...ages], ages.size]);
}
reportAll("first");
reportAll("second");
names.add("epsilon");
names.delete("beta");
ages.set("dee", 52);
ages.set("ann", 32);
ages.delete("bob");
reportAll("changed");
