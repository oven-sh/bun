// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const counts: number[] = [1, 2, 3];
const double = Reflect.get(counts, "map") as typeof counts.map; // @ts-expect-error
const doubled: number[] = double.call(counts, (count: number): number => count * 2);
console.log(doubled.join());
