(globalThis.log ??= []).push("setup");
globalThis.ready = true;
globalThis.seen = [globalThis.first, globalThis.late, globalThis.other].join();
