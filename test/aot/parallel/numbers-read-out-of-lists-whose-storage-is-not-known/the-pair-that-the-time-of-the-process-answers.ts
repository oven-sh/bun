function spent(since: [number, number]): number { const duration = process.hrtime(since); return duration[0] * 1000 + duration[1] / 1e6; }
console.log(spent(process.hrtime()) >= 0);
