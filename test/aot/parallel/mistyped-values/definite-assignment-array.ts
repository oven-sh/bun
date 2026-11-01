function run(argument: string): void {
  class B {
    items!: number[];
    size(): number {
      try {
        return this.items.length;
      } catch (e) {
        return -1;
      }
    }
  }
  const b = new B();
  if (argument !== "1") b.items = [1, 2];
  console.log(b.size());
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
