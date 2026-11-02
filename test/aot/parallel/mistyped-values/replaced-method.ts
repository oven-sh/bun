function run(argument: string): void {
  class C {
    xs: number[] = [1, 2];
    size(): number {
      return this.xs.length;
    }
  }
  const c = new C();
  if (argument === "1")
    c.size = function () {
      return 42;
    };
  if (argument === "2")
    C.prototype.size = function () {
      return 43;
    };
  function ask(o: C): number {
    return o.size();
  }
  console.log(ask(c));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
