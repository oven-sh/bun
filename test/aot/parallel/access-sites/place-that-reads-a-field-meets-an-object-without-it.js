// The layout of a class says where a field lies. Whether an object has the field it says itself.
// EACH PLACE IS WARMED ON ITS OWN: every step has a reader of its own, which is one place, asked 400 times before anything changes. A reader shared by all steps backs off and is filled no more.
// The steps run in text that the build has not seen, so nothing is known of what a reader is handed and no reader is copied into its caller.
class Base { }
Base.prototype.retries = 3;
class Job extends Base { constructor(n, withRetries) { super(); this.n = n; if (withRetries) this.retries = n; this.last = "l" + n; } }
class Seen { constructor(look) { this.first = 1; look(this); this.last = 2; look(this); } }
const readers = [o => o.retries, o => o.last, o => o.retries, o => o.last, o => o.retries, o => o.last, o => o.retries, o => o.last, o => o.retries, o => o.last, o => o.retries, o => o.last, o => o.retries, o => o.last, o => o.retries, o => o.last, o => o.retries, o => o.last, o => o.retries, o => o.last];
console.log(new Function("readers", "Job", "Seen", "Base", `
    const lines = [];
    let next = 0;
    const deeds = [
        job => { delete job.retries; },
        job => { delete job.retries; job.retries = 9; },
        job => { Object.defineProperty(job, "retries", { get() { return "getter"; }, configurable: true }); },
        job => { Object.defineProperty(job, "retries", { value: 11, writable: false }); },
        job => { job.retries = "text"; },
        job => { Object.setPrototypeOf(job, { retries: "above", last: "above" }); delete job.retries; delete job.last; },
        job => { Object.freeze(job); },
    ];
    for (const deed of deeds) {
        const retriesOf = readers[next++], lastOf = readers[next++];
        let sum = 0;
        for (let turn = 0; turn < 400; turn++) sum += retriesOf(new Job(turn, true)) + lastOf(new Job(turn, true)).length;
        const job = new Job(5, true);
        deed(job);
        lines.push(sum + " " + retriesOf(job) + " " + lastOf(job) + " " + retriesOf(new Job(1, false)) + " " + retriesOf(new Job(2, true)) + " " + lastOf(new Job(2, false)));
    }
    {
        // While it is being made.
        const firstOf = readers[next++], lastOf = readers[next++];
        for (let turn = 0; turn < 400; turn++) lastOf(new Seen(() => { }));
        const seen = []; new Seen(o => seen.push(lastOf(o))); lines.push(seen.join());
    }
    {
        // With and without in turns, at one place.
        const retriesOf = readers[next++], lastOf = readers[next++];
        let wrong = 0;
        for (let turn = 0; turn < 800; turn++) { const job = new Job(turn, turn % 2 === 0); if (retriesOf(job) !== (turn % 2 === 0 ? turn : 3) || lastOf(job) !== "l" + turn) wrong++; }
        delete Base.prototype.retries;
        lines.push(wrong + " " + retriesOf(new Job(1, false)) + " " + retriesOf(new Job(4, true)));
    }
    return lines.join("\\n");
`)(readers, Job, Seen, Base));
