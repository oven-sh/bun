const key = "made";
const table: Record<string, number> = { made: 7 };
class Base {
  static *[Symbol.iterator]() { yield 1; }
}
class Marked {
  first = table
  static readonly [key] = 2
}
class Listed extends Base {
  items = [1, 2]
  static override *[Symbol.iterator]() { yield 3; }
}
class Named {
  first = 1
  static readonly in = 2
  public static readonly instanceof = 3
}
class Both {
  first = table
  public static readonly [key] = 4
  private readonly [key] = 5
}
for (const asked of [Marked, Listed, Named, Both]) {
  try {
    const again = new Function("key", "table", "Base", "return (" + String(asked) + "\n)")(key, table, Base);
    console.log(asked.name, JSON.stringify(new again()), JSON.stringify(Object.getOwnPropertyNames(again).sort()), String(again[key]), Symbol.iterator in again ? String([...again]) : "-");
  } catch (error) {
    console.log(asked.name, (error as Error).name);
  }
}
