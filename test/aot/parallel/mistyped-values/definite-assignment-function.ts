function run(argument: string): void {
  class F {
    cb!: () => number;
    f(): number {
      try {
        return this.cb();
      } catch (e) {
        return -1;
      }
    }
  }
  const f = new F();
  if (argument !== "1") f.cb = () => 5;
  console.log(f.f());
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
