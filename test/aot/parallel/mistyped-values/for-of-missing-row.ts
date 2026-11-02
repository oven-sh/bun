function run(argument: string): void {
  const t: number[][] = [[1, 2]];
  function sum(a: number[][], i: number): number {
    let s = 0;
    try {
      for (const x of a[i]) s += x;
    } catch (e) {
      return -1;
    }
    return s;
  }
  console.log(sum(t, Number(argument ?? 0)));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
