// Flags: --aot-check=verify-each-pass
// A list is walked in a try, and each turn makes a class and an object of it. The list was there before any of those objects: what is known of it holds across their constructor.
function run(argument: string): void {
  interface H {
    h(x: number[] | undefined): number;
  }
  class I implements H {
    h(x: number[]): number {
      try {
        return x.length;
      } catch (e) {
        return -1;
      }
    }
  }
  const hh: H = new I();
  console.log(hh.h(argument === "1" ? undefined : [1, 2]));
}
try { for (const argument of JSON.parse('["0", "1", "2", "7"]') as string[]) run(argument); } catch (caughtAroundLoop) { throw caughtAroundLoop; } finally { (globalThis as any).loopsLeft = ((globalThis as any).loopsLeft | 0) + 1; }
export {};
