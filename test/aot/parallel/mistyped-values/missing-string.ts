function run(argument: string): void {
  const s: string[] = ["abc"];
  function len(a: string[], i: number): number {
    try {
      return a[i].length;
    } catch (e) {
      return -1;
    }
  }
  console.log(len(s, Number(argument ?? 0)));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
