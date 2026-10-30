function run(argument: string): void {
  const table: number[][] = [
    [1, 2, 3],
    [4, 5],
  ];
  function rowLength(t: number[][], i: number): string {
    const row: number[] = t[i];
    try {
      return "ok " + row.length;
    } catch (e) {
      return "caught " + typeof row;
    }
  }
  const which = Number(argument ?? 0);
  console.log(rowLength(table, which));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
