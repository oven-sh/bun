// A standard stream loads node:events, which lays its EventEmitter.prototype above the native prototype of `process`: a field that lies there alone is found off `process`.
process.stdout.write("start\n");
process.stdout.write(typeof process._eventsCount + " " + process._eventsCount + " " + ("_eventsCount" in process) + "\n");
