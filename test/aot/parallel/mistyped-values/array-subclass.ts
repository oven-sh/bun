function run(argument: string): void {
  class Stack extends Array<number> {
    top(): number {
      return this[this.length - 1];
    }
  }
  const s = new Stack();
  s.push(1, 2, 3);
  function len(a: number[]): number {
    return a.length;
  }
  console.log(len(argument === "1" ? s : [1]));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
