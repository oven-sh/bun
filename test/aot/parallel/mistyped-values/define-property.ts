function run(argument: string): void {
  interface P {
    xs: number[];
  }
  const p: P = { xs: [1, 2] };
  if (argument === "1") Object.defineProperty(p, "xs", { value: 5 });
  function len(o: P): string {
    try {
      return String(o.xs.length);
    } catch (e) {
      return "caught";
    }
  }
  console.log(len(p));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
