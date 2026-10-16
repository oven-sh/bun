// A fake clock that replaced process.nextTick and is never advanced (what sinon/jest fake timers do when nextTick is faked).
const queued = [];
process.nextTick = function fakeNextTick(fn, ...args) { queued.push([fn, args]); };
const ev = [];
process.stdout.write("x\n", () => ev.push("stdout write cb"));
process.stderr.write("", () => ev.push("stderr write cb"));
setTimeout(() => { require("fs").writeSync(2, JSON.stringify({ ev, queuedOnFakeClock: queued.length }) + "\n"); }, 100);
