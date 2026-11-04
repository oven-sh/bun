// the try has stored and logged; behind the failing read the slow road throws: the handler of the same function catches it and sees the stores once
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Gate { limit: number; constructor(limit: number) { this.limit = limit; } }
const log: string[] = [];
function pass(gate: Gate, load: number): string {
    let state = "start";
    let tries = 0;
    try {
        tries++;
        state = "in try";
        log.push("try " + load);
        if (load > gate.limit) throw new RangeError("over " + gate.limit);
        state = "passed";
        return state + " " + tries;
    } catch (error) {
        return state + " " + tries + " " + (error as Error).message;
    } finally {
        log.push("finally " + state);
    }
}
const passByValue = through(pass);
const thrower: any = { get limit() { throw new TypeError("no limit"); } };
for (const gate of [new Gate(5), { limit: 5 }, thrower] as any[]) console.log(passByValue(gate, 3), "|", passByValue(gate, 8));
console.log(log.join());
