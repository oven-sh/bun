// the callee has no handler: it is left, and what is thrown behind the point arrives at the handler of whoever called
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Wire { volts: number; constructor(volts: number) { this.volts = volts; } }
const log: string[] = [];
function probe(wire: Wire, scale: number): number { log.push("probe"); const volts = wire.volts; if (volts > 100) throw new RangeError("high " + volts * scale); return volts * scale; }
function guardAll(wires: Wire[]): string {
    let out = "";
    for (let i = 0; i < wires.length; i++) {
        try { out += probe(wires[i], i + 1) + ";"; } catch (error) { out += "[" + (error as Error).message + "];"; }
    }
    return out;
}
const probeByValue = through(probe);
function guardEach(wires: Wire[]): string {
    let out = "";
    for (let i = 0; i < wires.length; i++) {
        try { out += probeByValue(wires[i], i + 1) + ";"; } catch (error) { out += "[" + (error as Error).message + "];"; }
    }
    return out;
}
const guardAllByValue = through(guardAll);
console.log(guardAllByValue([new Wire(1), { volts: 2 }, new Wire(200), { volts: 300 }, { get volts() { throw new Error("cut"); } }, null, new Wire(5)] as any), log.length);
console.log(guardEach([new Wire(1), { volts: 2 }, new Wire(200), { volts: 300 }, { get volts() { throw new Error("cut"); } }, null, new Wire(5)] as any), log.length);
