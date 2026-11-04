function run(argument: string): void {
  const m = new Map<string, number[]>([["a", [1, 2]]]);
  function len(k: string): number {
    try {
      return m.get(k)!.length;
    } catch (e) {
      return -1;
    }
  }
  console.log(len(argument === "1" ? "zz" : "a"));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
