// Quotients that go through casts to another primitive type before Math.floor, ceil, round or trunc. A cast is a test and never a conversion: a number cast to boolean or string throws a TypeError, whether the compiler sees the division or not.
declare const console: any;
function any(x: unknown): any { return x }
function show(v: unknown): string { return typeof v + " " + (Object.is(v, -0) ? "-0" : String(v)) }
function failure(e: unknown): string { return "throws " + (e as Error).constructor.name }
const G: unknown[] = ((globalThis as any).G = [0]);
function hide(x: unknown): any { G[0] = x; return G[0] }
function floored(x: number): unknown { return Math.floor(x) }
function ceiled(x: number): unknown { return Math.ceil(x) }
function rounded(x: number): unknown { return Math.round(x) }
function truncated(x: number): unknown { return Math.trunc(x) }
function floorByTwo(l: number[]): unknown { return floored((l.length / 2) as any as boolean as any as number) }
function floorByTwoHidden(l: number[]): unknown { return floored(hide(l.length / 2) as any as boolean as any as number) }
function ceilByTwo(l: number[]): unknown { return ceiled((l.length / 2) as any as boolean as any as number) }
function ceilByTwoHidden(l: number[]): unknown { return ceiled(hide(l.length / 2) as any as boolean as any as number) }
function roundByTwo(l: number[]): unknown { return rounded((l.length / 2) as any as boolean as any as number) }
function roundByTwoHidden(l: number[]): unknown { return rounded(hide(l.length / 2) as any as boolean as any as number) }
function truncByTwo(l: number[]): unknown { return truncated((l.length / 2) as any as boolean as any as number) }
function truncByTwoHidden(l: number[]): unknown { return truncated(hide(l.length / 2) as any as boolean as any as number) }
function floorByThree(l: number[]): unknown { return floored((l.length / 3) as any as boolean as any as number) }
function floorByThreeHidden(l: number[]): unknown { return floored(hide(l.length / 3) as any as boolean as any as number) }
function floorByTwoThroughCalls(l: number[]): unknown { return floored(any(any((l.length / 2)) as boolean) as number) }
function floorByTwoThroughCallsHidden(l: number[]): unknown { return floored(any(any(hide(l.length / 2)) as boolean) as number) }
function floorThroughText(l: number[]): unknown { return floored((l.length / 2) as any as string as any as number) }
function floorThroughTextHidden(l: number[]): unknown { return floored(hide(l.length / 2) as any as string as any as number) }
function floorHeld(l: number[]): unknown { const x: number = (l.length / 2) as any as boolean as any as number; return Math.floor(x) }
function floorHeldHidden(l: number[]): unknown { const x: number = hide(l.length / 2) as any as boolean as any as number; return Math.floor(x) }
function floorHonest(l: number[]): unknown { return floored((l.length / 2) as any as number) }
function floorHonestHidden(l: number[]): unknown { return floored(hide(l.length / 2) as any as number) }
function floorPlain(l: number[]): unknown { return floored((l.length / 2)) }
function floorPlainHidden(l: number[]): unknown { return floored(hide(l.length / 2)) }
const inSight: ((...a: any[]) => unknown)[] = [floorByTwo, ceilByTwo, roundByTwo, truncByTwo, floorByThree, floorByTwoThroughCalls, floorThroughText, floorHeld, floorHonest, floorPlain];
const hidden: ((...a: any[]) => unknown)[] = [floorByTwoHidden, ceilByTwoHidden, roundByTwoHidden, truncByTwoHidden, floorByThreeHidden, floorByTwoThroughCallsHidden, floorThroughTextHidden, floorHeldHidden, floorHonestHidden, floorPlainHidden];
const names = ["floorByTwo", "ceilByTwo", "roundByTwo", "truncByTwo", "floorByThree", "floorByTwoThroughCalls", "floorThroughText", "floorHeld", "floorHonest", "floorPlain"];
const given: (() => any[])[] = [() => [[1, 2, 3, 4, 5, 6, 7]], () => [[1, 2]]];
const said = ["[1, 2, 3, 4, 5, 6, 7]", "[1, 2]"];
let a = "", b = "";
for (let turn = 0; turn < 3; turn++) {
  for (let i = 0; i < names.length; i++) {
    for (let j = 0; j < given.length; j++) {
      try { a = show(inSight[i](...given[j]())) } catch (e) { a = failure(e) }
      try { b = show(hidden[i](...given[j]())) } catch (e) { b = failure(e) }
      console.log(names[i] + " " + said[j] + ": " + (a === b ? "same: " + a : "DIFFERS: in sight: " + a + " | hidden: " + b));
    }
  }
}
