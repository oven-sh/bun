function run(argument: string): void {
  interface O {
    xs?: number[];
  }
  const o: O = { xs: [1, 2] };
  function clear(x: O): void {
    if (argument === "1") x.xs = undefined;
  }
  function f(x: O): number {
    try {
      if (x.xs) {
        clear(x);
        return x.xs.length;
      }
      return 0;
    } catch (e) {
      return -1;
    }
  }
  console.log(f(o));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
