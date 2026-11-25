function outer(run) { const early = run(read); let n = 1; n++; return early + ":" + read(); function read() { try { return n; } catch (e) { return e.constructor.name; } } }
console.log(outer(f => f()));
