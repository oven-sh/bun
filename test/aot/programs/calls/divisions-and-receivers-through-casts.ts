// Quotients, method receivers, functions and arrays that go through casts to a primitive type of another kind. A cast is a test and never a conversion: a primitive of another kind throws a TypeError there, an object (a function, an array) passes, whether the compiler sees the value or not.
declare const console: any;
function any(x: unknown): any { return x }
function show(v: unknown): string { return typeof v + " " + (Object.is(v, -0) ? "-0" : String(v)) }
function failure(e: unknown): string { return "throws " + (e as Error).constructor.name }
const G: unknown[] = ((globalThis as any).G = [0]);
function hide(x: unknown): any { G[0] = x; return G[0] }
function floorByTwo(l: number[]): unknown { return Math.floor(any(any((l.length / 2)) as boolean) as number) }
function floorByTwoHidden(l: number[]): unknown { return Math.floor(any(any(hide(l.length / 2)) as boolean) as number) }
function floorByTwoWritten(l: number[]): unknown { return Math.floor((l.length / 2) as any as boolean as any as number) }
function floorByTwoWrittenHidden(l: number[]): unknown { return Math.floor(hide(l.length / 2) as any as boolean as any as number) }
function ceilByTwoWritten(l: number[]): unknown { return Math.ceil((l.length / 2) as any as boolean as any as number) }
function ceilByTwoWrittenHidden(l: number[]): unknown { return Math.ceil(hide(l.length / 2) as any as boolean as any as number) }
function roundByTwoWritten(l: number[]): unknown { return Math.round((l.length / 2) as any as boolean as any as number) }
function roundByTwoWrittenHidden(l: number[]): unknown { return Math.round(hide(l.length / 2) as any as boolean as any as number) }
function truncByTwoWritten(l: number[]): unknown { return Math.trunc((l.length / 2) as any as boolean as any as number) }
function truncByTwoWrittenHidden(l: number[]): unknown { return Math.trunc(hide(l.length / 2) as any as boolean as any as number) }
function floorByThreeWritten(l: number[]): unknown { return Math.floor((l.length / 3) as any as boolean as any as number) }
function floorByThreeWrittenHidden(l: number[]): unknown { return Math.floor(hide(l.length / 3) as any as boolean as any as number) }
function floorThroughTextWritten(l: number[]): unknown { return Math.floor((l.length / 2) as any as string as any as number) }
function floorThroughTextWrittenHidden(l: number[]): unknown { return Math.floor(hide(l.length / 2) as any as string as any as number) }
function floorHonest(l: number[]): unknown { return Math.floor((l.length / 2) as any as number) }
function floorHonestHidden(l: number[]): unknown { return Math.floor(hide(l.length / 2) as any as number) }
function floorPlain(l: number[]): unknown { return Math.floor((l.length / 2)) }
function floorPlainHidden(l: number[]): unknown { return Math.floor(hide(l.length / 2)) }
function toFixedOfText(l: number[]): unknown { const x = any(("7")); const c = x as number; return c.toFixed.call(x) }
function toFixedOfTextHidden(l: number[]): unknown { const x = any(hide("7")); const c = x as number; return c.toFixed.call(x) }
function toStringOfNumber(l: number[]): unknown { const x = any((5)); const c = x as string; return c.toString.call(x) }
function toStringOfNumberHidden(l: number[]): unknown { const x = any(hide(5)); const c = x as string; return c.toString.call(x) }
function toStringOfNumberApart(l: number[]): unknown { const x = any((5)); const c = any((5)) as string; return c.toString.call(x) }
function toStringOfNumberApartHidden(l: number[]): unknown { const x = any(hide(5)); const c = any(hide(5)) as string; return c.toString.call(x) }
function valueOfOfBoolean(l: number[]): unknown { const x = any((true)); const c = x as string; return c.valueOf.call(x) }
function valueOfOfBooleanHidden(l: number[]): unknown { const x = any(hide(true)); const c = x as string; return c.valueOf.call(x) }
function valueOfOfBooleanApart(l: number[]): unknown { const x = any((true)); const c = any((true)) as string; return c.valueOf.call(x) }
function valueOfOfBooleanApartHidden(l: number[]): unknown { const x = any(hide(true)); const c = any(hide(true)) as string; return c.valueOf.call(x) }
function charAtOfBoolean(l: number[]): unknown { const x = any((true)); const c = x as string; return c.charAt.call(x, 1) }
function charAtOfBooleanHidden(l: number[]): unknown { const x = any(hide(true)); const c = x as string; return c.charAt.call(x, 1) }
function valueOfOfText(l: number[]): unknown { const x = any(("12")); const c = x as number; return c.valueOf.call(x) }
function valueOfOfTextHidden(l: number[]): unknown { const x = any(hide("12")); const c = x as number; return c.valueOf.call(x) }
function maxOfList(l: number[]): unknown { return (any((Math.max)) as (...n: number[]) => number).apply(null, l) }
function maxOfListHidden(l: number[]): unknown { return (any(hide(Math.max)) as (...n: number[]) => number).apply(null, l) }
function functionAsNumber(l: number[]): unknown { return (any(any((Math.max)) as number) as (...n: number[]) => number)(1, 2) }
function functionAsNumberHidden(l: number[]): unknown { return (any(any(hide(Math.max)) as number) as (...n: number[]) => number)(1, 2) }
function closureAsNumber(l: number[]): unknown { const f = (): number => 7; return (any(any((f)) as number) as () => number)() }
function closureAsNumberHidden(l: number[]): unknown { const f = (): number => 7; return (any(any(hide(f)) as number) as () => number)() }
function listAsNumber(l: number[]): unknown { return (any(any((l)) as number) as number[]).length }
function listAsNumberHidden(l: number[]): unknown { return (any(any(hide(l)) as number) as number[]).length }
function functionHeldAsNumber(l: number[]): unknown { const n: number = any((Math.max)) as number; return (any(n) as (...n: number[]) => number)(1, 2) }
function functionHeldAsNumberHidden(l: number[]): unknown { const n: number = any(hide(Math.max)) as number; return (any(n) as (...n: number[]) => number)(1, 2) }
const inSight: ((...a: any[]) => unknown)[] = [floorByTwo, floorByTwoWritten, ceilByTwoWritten, roundByTwoWritten, truncByTwoWritten, floorByThreeWritten, floorThroughTextWritten, floorHonest, floorPlain, toFixedOfText, toStringOfNumber, toStringOfNumberApart, valueOfOfBoolean, valueOfOfBooleanApart, charAtOfBoolean, valueOfOfText, maxOfList, functionAsNumber, closureAsNumber, listAsNumber, functionHeldAsNumber];
const hidden: ((...a: any[]) => unknown)[] = [floorByTwoHidden, floorByTwoWrittenHidden, ceilByTwoWrittenHidden, roundByTwoWrittenHidden, truncByTwoWrittenHidden, floorByThreeWrittenHidden, floorThroughTextWrittenHidden, floorHonestHidden, floorPlainHidden, toFixedOfTextHidden, toStringOfNumberHidden, toStringOfNumberApartHidden, valueOfOfBooleanHidden, valueOfOfBooleanApartHidden, charAtOfBooleanHidden, valueOfOfTextHidden, maxOfListHidden, functionAsNumberHidden, closureAsNumberHidden, listAsNumberHidden, functionHeldAsNumberHidden];
const names = ["floorByTwo", "floorByTwoWritten", "ceilByTwoWritten", "roundByTwoWritten", "truncByTwoWritten", "floorByThreeWritten", "floorThroughTextWritten", "floorHonest", "floorPlain", "toFixedOfText", "toStringOfNumber", "toStringOfNumberApart", "valueOfOfBoolean", "valueOfOfBooleanApart", "charAtOfBoolean", "valueOfOfText", "maxOfList", "functionAsNumber", "closureAsNumber", "listAsNumber", "functionHeldAsNumber"];
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
