let ran = 0, burst = 0;
for (let i = 0; i < 300000; i++) process.nextTick(() => { burst++; });
function step() { if (++ran < 50000) process.nextTick(step); else { for (let i = 0; i < 10000; i++) process.nextTick(() => { burst++; }); process.nextTick(() => console.log("ran", ran, burst)); } }
process.nextTick(step);
