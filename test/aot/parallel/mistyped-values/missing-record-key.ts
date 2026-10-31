function run(argument: string): void {
  const m: Record<string, number[]> = { a: [1, 2] };
  function len(r: Record<string, number[]>, k: string): number {
    try {
      return r[k].length;
    } catch (e) {
      return -1;
    }
  }
  console.log(len(m, argument === "1" ? "zz" : "a"));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
