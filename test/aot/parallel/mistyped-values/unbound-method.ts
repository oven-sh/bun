function run(argument: string): void {
  class C {
    xs: number[] = [1, 2];
    size(): number {
      try {
        return this.xs.length;
      } catch (e) {
        return -1;
      }
    }
  }
  const c = new C();
  const f = c.size;
  console.log(argument === "1" ? f() : c.size());
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
