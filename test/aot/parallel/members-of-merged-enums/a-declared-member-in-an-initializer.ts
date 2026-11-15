declare enum Mode { Off, Fast }
enum Mode { Slow = Mode.Fast + 1 }
console.log(String(Mode.Slow), Mode.Slow === 2 ? "folded" : "read at run time");
