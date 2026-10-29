function run(argument: string): void {
  function isRow(x: unknown): x is number[] {
    return true;
  }
  function f(v: unknown): string {
    try {
      if (isRow(v)) return String(v.length);
      return "no";
    } catch (e) {
      return "caught";
    }
  }
  console.log(f(argument === "1" ? undefined : [1, 2]));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
