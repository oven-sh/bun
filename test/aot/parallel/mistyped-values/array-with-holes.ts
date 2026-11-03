function run(argument: string): void {
  const t: number[][] = new Array<number[]>(3);
  t[0] = [1, 2];
  function len(a: number[][], i: number): number {
    try {
      return a[i].length;
    } catch (e) {
      return -1;
    }
  }
  console.log(len(t, Number(argument ?? 0)));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
