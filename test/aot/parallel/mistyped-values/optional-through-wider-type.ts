function run(argument: string): void {
  const p = { a: 1 };
  const q: {} = p;
  const r: { a?: number[] } = argument === "1" ? q : { a: [1, 2] };
  function len(o: { a?: number[] }): string {
    try {
      return o.a ? String(o.a.length) : "none";
    } catch (e) {
      return "caught";
    }
  }
  console.log(len(r));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
