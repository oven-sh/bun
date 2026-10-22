// An addition with its two reads on two lines reports the line of the read that threw.
function lineIn(name: string, error: unknown): string {
  const found = String((error as Error).stack)
    .split("\n")
    .find(line => line.includes("at " + name + " "));
  return /:(\d+):\d+\)?$/.exec(found ?? "")?.[1] ?? "none";
}
const fail = (): number => {
  throw new Error("read");
};
// prettier-ignore
function add(o: { a: number; b: number }): number {
  return o.a +
    o.b;
}
// prettier-ignore
function addUntyped(o: any): number {
  return o.a +
    o.b;
}
function report(label: string, name: string, read: () => number): void {
  try {
    console.log(label, "returned", read());
  } catch (error) {
    console.log(label, (error as Error).constructor.name, lineIn(name, error));
  }
}

report("first", "add", () => add({ get a() { return fail(); }, b: 2 }));
report("second", "add", () => add({ a: 1, get b() { return fail(); } }));
report("both return", "add", () => add({ get a() { return 1; }, get b() { return 2; } }));
report("untyped first", "addUntyped", () => addUntyped({ get a() { return fail(); }, b: 2 }));
report("untyped second", "addUntyped", () => addUntyped({ a: 1, get b() { return fail(); } }));
report("untyped null", "addUntyped", () => addUntyped(null));
report("untyped both return", "addUntyped", () => addUntyped({ get a() { return 1; }, get b() { return 2; } }));
