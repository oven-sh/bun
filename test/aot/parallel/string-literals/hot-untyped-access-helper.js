const texts = ["start", "middle", "end", ""];
export function readAll(steps) { let all = ""; for (const s of steps) all += s.phase + "|"; return all; }
export function countOf(steps, phase) { let n = 0; for (const s of steps) if (s.phase === phase) n++; return n; }
export function writeAll(steps, round) {
    for (let i = 0; i < steps.length; i++) {
        const k = (i + round) % 7;
        steps[i].phase = k < 4 ? texts[k] : k === 4 ? "mid" + "dle".slice(0, 3) : k === 5 ? "made " + (round % 3) : ["e", "nd"].join("");
        steps[i].next = k === 0 ? undefined : texts[k % 4];
    }
}
export function swap(steps) {
    for (let i = 1; i < steps.length; i++) { const held = steps[i].phase; steps[i].phase = steps[i - 1].phase; steps[i - 1].phase = held; }
}
