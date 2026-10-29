function run(argument: string): void {
  class C {
    xs: number[] = [1, 2];
    size(): number {
      return this.xs.length;
    }
  }
  const other: C = {
    xs: [1, 2, 3],
    size() {
      return 7;
    },
  };
  function ask(o: C): string {
    return o.size() + ":" + o.xs.length;
  }
  console.log(ask(argument === "1" ? other : new C()));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
