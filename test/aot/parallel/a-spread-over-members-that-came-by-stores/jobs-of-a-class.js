class Job { constructor(id, name) { this.id = id; this.name = name; this.startedAt = null; } }
const jobs = [new Job(1, "build"), new Job(2, "test")];
for (const j of jobs) j.error = undefined;
const started = jobs.map((j) => ({ ...j, startedAt: Date.now() }));
console.log(started.length, typeof started[0].startedAt, started[1].name);
