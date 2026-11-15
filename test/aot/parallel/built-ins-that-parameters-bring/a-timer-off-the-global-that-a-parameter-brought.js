function timer(o) { return o.setTimeout; } timer(globalThis)(word => console.log("timer", word), 1, "fired");
