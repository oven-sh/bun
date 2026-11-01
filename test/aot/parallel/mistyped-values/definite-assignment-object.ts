function run(argument: string): void {
  class L {
    v: number = 3;
    next!: L;
    f(): number {
      try {
        return this.next.v;
      } catch (e) {
        return -1;
      }
    }
  }
  const l = new L();
  if (argument !== "1") l.next = new L();
  console.log(l.f());
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
