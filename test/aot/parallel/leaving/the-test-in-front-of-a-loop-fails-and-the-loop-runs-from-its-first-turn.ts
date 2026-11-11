// what the loop reads from in front of it is not what is written: nothing of the loop has run, all in front of it has
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Scale { factor: number; constructor(factor: number) { this.factor = factor; } }
const log: string[] = [];
function stretch(values: number[], scale: Scale): number {
    log.push("in front");
    let sum = values.length;
    for (let i = 0; i < values.length; i++) sum += values[i] * scale.factor;
    log.push("behind");
    return sum;
}
const stretchByValue = through(stretch);
let reads = 0;
console.log(stretchByValue([1, 2, 3], new Scale(2)), stretchByValue([1, 2, 3], { factor: 3 } as any), stretchByValue([], { factor: 3 } as any), stretchByValue([4, 5], { get factor() { return ++reads; } } as any), reads, log.join());
