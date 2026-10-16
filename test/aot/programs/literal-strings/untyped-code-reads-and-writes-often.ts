// Untyped code reads and writes such fields by name, often enough for every cache to be in use.
import { readAll, writeAll, swap, countOf } from "./untyped-code-reads-and-writes-often-helper.js";
type Phase = "start" | "middle" | "end" | "";
class Step {
    next: Phase | undefined = undefined;
    constructor(public phase: Phase, public id: number) {}
}
function step(phase: Phase, id: number): Step {
    return new Step(phase, id);
}
function tally(steps: Step[]): string {
    let start = 0, middle = 0, end = 0, empty = 0, other = 0, none = 0;
    for (const s of steps) {
        switch (s.phase) {
            case "start": start++; break;
            case "middle": middle++; break;
            case "end": end++; break;
            case "": empty++; break;
            default: other++;
        }
        if (s.next === undefined) none++;
    }
    return [start, middle, end, empty, other, none].join();
}
const phases: Phase[] = ["start", "middle", "end", ""];
const steps: Step[] = [];
for (let i = 0; i < 400; i++) steps.push(step(phases[i % 4], i));
console.log(tally(steps), readAll(steps).length, countOf(steps, "middle"), countOf(steps, ""));
for (let round = 0; round < 50; round++) {
    writeAll(steps, round);
    if (round % 10 === 0) console.log(round, tally(steps), countOf(steps, "end"), countOf(steps, "made " + (round % 3)));
}
for (let round = 0; round < 50; round++) swap(steps);
console.log(tally(steps), steps[0].phase, steps[1].phase, steps[2].next, steps[3].next, JSON.stringify(steps[5]));
let same = 0;
for (let i = 1; i < steps.length; i++) same += steps[i].phase === steps[i - 1].phase ? 1 : 0;
console.log(same, readAll(steps).slice(0, 60));
