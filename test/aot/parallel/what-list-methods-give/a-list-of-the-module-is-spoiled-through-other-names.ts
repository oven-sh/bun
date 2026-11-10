// Six lists of the module are each mapped and walked by a function of their own. One stays as it was made; the others get another species in the midst of the run, each by another road.
// STATISTIC: LibraryResultsCheckedAgainstSignatures >= 1
function Made(this: any, length: number) { this.madeWith = length; this.length = 0; }
class Stack extends Array<number> { static get [Symbol.species]() { return Made as any; } }
const other = { [Symbol.species]: Made };
const whole: number[] = [1, 2, 3], byAlias: number[] = [1, 2, 3], byDefine: number[] = [1, 2, 3], byReflect: number[] = [1, 2, 3], byAssign: number[] = [1, 2, 3], byPrototype: number[] = [1, 2, 3];
function tried(walk: () => number): string { try { return String(walk()); } catch (error) { return (error as Error).constructor.name; } }
function ofWhole(): number { let sum = 0; for (const x of whole.map(x => x * 2)) sum += x; for (const x of whole.filter(x => x > 1)) sum += x; return sum; }
function ofAlias(): number { let sum = 0; for (const x of byAlias.map(x => x * 2)) sum += x; return sum; }
function ofDefine(): number { let sum = 0; for (const x of byDefine.map(x => x * 2)) sum += x; return sum; }
function ofReflect(): number { let sum = 0; for (const x of byReflect.filter(x => x > 1)) sum += x; return sum; }
function ofAssign(): number { let sum = 0; for (const x of byAssign.map(x => x * 2)) sum += x; return sum; }
function ofPrototype(): number { let sum = 0; for (const x of byPrototype.map(x => x * 2)) sum += x; return sum; }
function spoil(list: any): void { list.constructor = other; }
const said: string[] = [];
for (let turn = 0; turn < 40; turn++) {
  if (turn === 30) {
    spoil(byAlias);
    Object.defineProperty(byDefine, "constructor", { value: other });
    Reflect.set(byReflect, "constructor", other);
    Object.assign(byAssign, { constructor: other });
    Object.setPrototypeOf(byPrototype, Stack.prototype);
  }
  if (turn > 27) said.push([ofWhole, ofAlias, ofDefine, ofReflect, ofAssign, ofPrototype].map(tried).join());
}
console.log(said.join("|")); export {};
