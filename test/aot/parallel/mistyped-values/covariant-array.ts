function run(argument: string): void {
  const rows: number[][] = [[1, 2, 3]];
  const wider: (number[] | string)[] = rows;
  if (argument === "1") wider.push("abcde");
  function last(t: number[][]): number {
    try {
      return t[t.length - 1].length;
    } catch (e) {
      return -1;
    }
  }
  console.log(last(rows));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
