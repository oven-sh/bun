function run(argument: string): void {
  const f: Float64Array[] = [new Float64Array(3)];
  function len(a: Float64Array[], i: number): number {
    try {
      return a[i].length;
    } catch (e) {
      return -1;
    }
  }
  console.log(len(f, Number(argument ?? 0)));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
