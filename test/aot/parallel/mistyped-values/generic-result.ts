function run(argument: string): void {
  function parse<T>(s: string): T {
    return JSON.parse(s);
  }
  function f(s: string): string {
    try {
      return String(parse<number[]>(s).length);
    } catch (e) {
      return "caught";
    }
  }
  console.log(f(argument === "1" ? "null" : "[1,2]"));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
