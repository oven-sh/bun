function run(argument: string): void {
  interface Narrow {
    xs: number[];
  }
  interface Wide {
    xs: number[] | string;
  }
  const n: Narrow = { xs: [1, 2] };
  const wd: Wide = n;
  if (argument === "1") {
    try {
      wd.xs = "abcde";
    } catch (e) {
      console.log("the store throws");
    }
  }
  function len(o: Narrow): number {
    try {
      return o.xs.length;
    } catch (e) {
      return -1;
    }
  }
  console.log(len(n));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
