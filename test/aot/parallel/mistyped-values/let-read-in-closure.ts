function run(argument: string): void {
  let x: number[];
  function r(): number {
    try {
      return x.length;
    } catch (e) {
      return -1;
    }
  }
  if (argument === "1") console.log(r());
  x = [1, 2];
  console.log(r());
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};
