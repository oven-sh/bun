const key = "made";
const table: Record<string, number> = { made: 7 };
class Stored {
  first = 1
  public [key] = 2
}
class Quiet {
  first = table
  public [key]?: number
}
class Listed {
  items = [1, 2]
  public *[Symbol.iterator]() { yield* this.items; }
}
class Named {
  first = 1
  protected in = 2
  second = 3
  private readonly instanceof = 4
}
class Control {
  first = 1;
  public [key] = 2;
}
for (const asked of [Stored, Quiet, Listed, Named, Control]) {
  try {
    const again = new Function("key", "table", "return (" + String(asked) + "\n)")(key, table);
    console.log(asked.name, JSON.stringify(new again()));
  } catch (error) {
    console.log(asked.name, (error as Error).name);
  }
}
