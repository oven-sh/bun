const clock = { read(since?: [number, number]): [number, number] { return since ? [since[0] + 1, since[1] + 0.5] : [1, 2]; } };
function spent(since: [number, number]): number { const duration = clock.read(since); return duration[0] * 1000 + duration[1] / 1e6; }
console.log(spent(clock.read()));
