function run(argument: string): void {
  class S {
    s!: string;
    len(): number {
      try {
        return this.s.length;
      } catch (e) {
        return -1;
      }
    }
  }
  const s = new S();
  if (argument !== "1") s.s = "abc";
  console.log(s.len());
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
