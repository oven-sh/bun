// Takes a list of lists through two list patterns and an object pattern, reads an element of the inner list there, and reads the same list again at the top level.
const inner = [5, 7];
function scene(value: number[][]): void {
    const [, ...others]: number[][][] = [value, value];
    const [first]: number[][][] = [others[0]];
    const { held }: { held: number[] } = { held: first[0] };
    console.log(held[1] - 1);
}
scene([inner]);
try { scene(Symbol.iterator as any); } catch {}
function twin(value: number[]): void {
    const { held }: { held: number[] } = { held: value };
}
try {
    // @ts-ignore
    twin(missing as any);
} catch {}
console.log(inner[1] - 1, inner[0] + inner[1], inner);
