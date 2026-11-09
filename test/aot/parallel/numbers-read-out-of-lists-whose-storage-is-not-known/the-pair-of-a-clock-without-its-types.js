const clock = { read(since) { return since ? [since[0] + 1, since[1] + 0.5] : [1, 2]; } };
function spent(since) { const duration = clock.read(since); return duration[0] * 1000 + duration[1] / 1e6; }
console.log(spent(clock.read()));
