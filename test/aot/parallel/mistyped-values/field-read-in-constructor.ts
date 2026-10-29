function run(argument: string): void {
  class Bag {
    items: number[];
    constructor(early: boolean) {
      if (early) console.log(this.size());
      this.items = [1];
    }
    size(): number {
      try {
        return this.items.length;
      } catch (e) {
        return -1;
      }
    }
  }
  console.log(new Bag(argument === "1").size());
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
