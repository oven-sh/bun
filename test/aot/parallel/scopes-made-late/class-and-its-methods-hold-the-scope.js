function make(quick) { if (quick) return null; let made = 0; class Counter { constructor() { made++; } static count() { return made; } } new Counter(); new Counter(); return Counter.count(); }
console.log(make(true), make(false));
