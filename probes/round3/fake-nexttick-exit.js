// mocha-style exit flush under a faked nextTick: process.stdout.write('', () => process.exit(7))
process.nextTick = function fakeNextTick() {};
process.stdout.write("report\n");
process.stdout.write("", () => process.exit(7));
setTimeout(() => { require("fs").writeSync(2, "flush callback never ran; exiting 9\n"); process.exit(9); }, 300);
