function run(argument: string): void {
  interface H {
    h(x: number[] | undefined): number;
  }
  class I implements H {
    h(x: number[]): number {
      try {
        return x.length;
      } catch (e) {
        return -1;
      }
    }
  }
  const hh: H = new I();
  console.log(hh.h(argument === "1" ? undefined : [1, 2]));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
