function* g(quick) { if (quick) { yield 0; return; } let n = 1; const bump = () => ++n; yield bump(); yield bump(); }
async function a(quick) { if (quick) return 0; await null; let n = 1; const bump = () => ++n; await null; return bump() + bump(); }
console.log([...g(true)].join(), [...g(false)].join()); a(true).then(console.log); a(false).then(console.log);
