const t0 = process.hrtime.bigint(); require("node:child_process"); const t1 = process.hrtime.bigint(); require("node:net"); const t2 = process.hrtime.bigint();
console.log(JSON.stringify({ child_process_us: Number(t1 - t0) / 1000, net_us: Number(t2 - t1) / 1000 }));
