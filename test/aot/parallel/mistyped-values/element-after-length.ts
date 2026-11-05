function run(argument: string): void {
  const t: number[][] = [[5, 6]];
  function f(a: number[][], i: number): string {
    let r: number[] = a[0];
    try {
      r = a[i];
      const n = r.length;
      return n + ":" + r[0];
    } catch (e) {
      return "caught";
    }
  }
  console.log(f(t, Number(argument ?? 0)));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
