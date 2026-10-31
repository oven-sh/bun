function run(argument: string): void {
  interface P {
    v: number;
  }
  const ps: P[] = [{ v: 1 }];
  function v(a: P[], i: number): number {
    try {
      return a[i].v;
    } catch (e) {
      return -1;
    }
  }
  console.log(v(ps, Number(argument ?? 0)));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
