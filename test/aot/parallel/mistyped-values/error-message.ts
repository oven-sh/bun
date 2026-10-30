function run(argument: string): void {
  interface P {
    v: number;
  }
  const ps: P[] = [{ v: 1 }];
  const rows: number[][] = [[1]];
  function a(x: P[], i: number): string {
    try {
      return String(x[i].v);
    } catch (e) {
      return (e as Error).constructor.name + ": " + (e as Error).message;
    }
  }
  function b(x: number[][], i: number): string {
    try {
      return String(x[i].length);
    } catch (e) {
      return (e as Error).constructor.name + ": " + (e as Error).message;
    }
  }
  const i = Number(argument ?? 0);
  console.log(a(ps, i));
  console.log(b(rows, i));
}
for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument);
export {};

/* Output:
1
1
TypeError: undefined is not an object (evaluating 'undefined.v')
TypeError: undefined is not an object (evaluating 'undefined.length')
TypeError: undefined is not an object (evaluating 'undefined.v')
TypeError: undefined is not an object (evaluating 'undefined.length')
TypeError: undefined is not an object (evaluating 'undefined.v')
TypeError: undefined is not an object (evaluating 'undefined.length')
*/
