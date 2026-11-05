enum Level { Low = 1, High = 2 }
const between = Level.Low;
function early() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return Level.Low + work; }
const called = early();
enum Level { Low = 5 }
console.log(between, called, early(), Level.Low);
