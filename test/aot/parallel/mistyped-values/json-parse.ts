function run(argument: string): void {
  const x: number[] = JSON.parse(argument === "1" ? "5" : "[1,2]");
  function len(a: number[]): string {
    try {
      return String(a.length);
    } catch (e) {
      return "caught";
    }
  }
  console.log(len(x));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
