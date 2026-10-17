globalThis.times++;
if (globalThis.times < 3) throw new Error("time " + globalThis.times);
module.exports = globalThis.times;
