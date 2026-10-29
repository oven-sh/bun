function run(argument: string): void {
  const t: number[][] = [[1]];
  function add(a: number[][], i: number): number {
    try {
      return a[i].push(7);
    } catch (e) {
      return -1;
    }
  }
  console.log(add(t, Number(argument ?? 0)));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
