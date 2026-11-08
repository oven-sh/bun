let ticks = 0;
function later() { process.nextTick(() => { ticks++; console.log(ticks); }); }
later();
