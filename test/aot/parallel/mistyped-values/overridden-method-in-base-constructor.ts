function run(argument: string): void {
  class Base {
    constructor() {
      console.log(this.size());
    }
    size(): number {
      return 0;
    }
  }
  class Derived extends Base {
    xs: number[] = [1, 2];
    size(): number {
      try {
        return this.xs.length;
      } catch (e) {
        return -1;
      }
    }
  }
  console.log(new Derived().size());
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
