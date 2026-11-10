// The const stands above its readers and is named bare, with nothing round the name: returned, handed over, stored, spread, captured, a default, a key, a case, a bound, a receiver. Numbers, booleans, texts, null and undefined.
const SIX = 6
const HALF = 0.5
const YES = true
const NAME = "name"
const EMPTY = ""
const NOTHING = null
const ABSENT = undefined
const WIDE = "wé世"
function returned(): unknown[] { return [SIX, HALF, YES, NAME, EMPTY, NOTHING, ABSENT, WIDE] }
function one(): number { return SIX }
function handed(f: (...all: unknown[]) => unknown): unknown { return f(SIX, NAME, NOTHING, ABSENT) }
function stored(): { a: number; b: string; SIX: number; NAME: string } { const made = { a: SIX, b: NAME, SIX, NAME }; return made }
function spread(): unknown[] { return [...[SIX], ...NAME] }
function captured(): () => unknown { return () => SIX }
function byDefault(a = SIX, b = NAME, c = ABSENT): string { return a + "|" + b + "|" + c }
function keyed(): string { const o: any = { [SIX]: "six", [NAME]: "named" }; return o[SIX] + o[NAME] + String(o[HALF]) }
function chosen(x: unknown): string { switch (x) { case SIX: return "six"; case NAME: return "name"; case NOTHING: return "nothing"; case ABSENT: return "absent"; case YES: return "yes"; default: return "other" } }
function bound(): number { let n = 0; for (let i = SIX; i > 0; i--) n += i; return n }
function received(): string { return SIX.toFixed(1) + NAME.toUpperCase() + HALF.toString() + YES.toString() + String(NOTHING?.["x"]) + String((ABSENT as any)?.x) + NAME.length + NAME[1] }
function asked(): string { return typeof SIX + typeof NAME + typeof NOTHING + typeof ABSENT + typeof YES + String(void SIX) + String(!SIX) + String(-SIX) + String(+NAME) + `${SIX}${NAME}${NOTHING}${ABSENT}` }
function tested(): string { return (SIX ? "a" : "b") + (EMPTY ? "a" : "b") + (NOTHING ?? "c") + (ABSENT ?? "d") + (EMPTY || "e") + (NAME && "f") }
async function awaited(): Promise<unknown> { return [await SIX, await NAME] }
function* yielded(): Generator<unknown> { yield SIX; yield NAME; yield ABSENT }
class Holder { six = SIX; static named = NAME; method(a = HALF) { return a } }
function shadowed(SIX: string): string { const NAME = 3; return SIX + NAME }
(globalThis as any).kit = { returned, one, handed, stored, spread, captured, byDefault, keyed, chosen, bound, received, asked, tested, awaited, yielded, Holder, shadowed }
const kit = (globalThis as any).kit
for (let round = 0; round < 2; round++) {
  console.log(JSON.stringify(kit.returned()), kit.one(), JSON.stringify(kit.handed((...all: unknown[]) => all)), JSON.stringify(kit.stored()), JSON.stringify(kit.spread()), kit.captured()())
  console.log(kit.byDefault(), kit.byDefault(1, "x", 2), kit.keyed(), [6, "name", null, undefined, true, 0.5, "6"].map(x => kit.chosen(x)).join(), kit.bound(), kit.received())
  console.log(kit.asked(), kit.tested(), JSON.stringify(await kit.awaited()), JSON.stringify([...kit.yielded()]), new kit.Holder().six, kit.Holder.named, new kit.Holder().method(), kit.shadowed("s"))
}
