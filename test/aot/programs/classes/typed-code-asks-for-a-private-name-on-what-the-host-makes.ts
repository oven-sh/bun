// Typed: the value that is asked is declared as an array, a function, a union with undefined, an object, unknown.
class Branded { #brand = 1; static isList(value: number[]): boolean { return #brand in value; } static isMaybe(value: number[] | undefined): boolean { return #brand in (value as object); } static isCall(value: () => void): boolean { return #brand in value; } static is(value: object): boolean { return #brand in value; } static isAny(value: unknown): boolean { return #brand in (value as object); } }
const lines: (string | number | boolean)[] = [];
const lists: (number[] | undefined)[] = [[1], [], undefined, [2, 3]];
let hits = 0, thrown = 0;
for (let i = 0; i < 400; i++) { try { hits += Branded.isMaybe(lists[i & 3]) ? 1 : 0; } catch (error) { thrown += error instanceof TypeError ? 1 : 100; } }
lines.push(hits, thrown, Branded.isList([1]), Branded.isCall(() => {}), Branded.is(new Branded()), Branded.is([]), Branded.isAny(new Branded()), Branded.isAny(new Map()));
const lying = new Branded() as unknown as number[];
lines.push(Branded.isList(lying), Branded.isMaybe(lying), Branded.isCall(lying as unknown as () => void));
for (const bad of [1, "s", null]) { try { lines.push(Branded.isList(bad as unknown as number[])); } catch (error) { lines.push((error as Error).constructor.name); } }
console.log(lines.join(" "));
