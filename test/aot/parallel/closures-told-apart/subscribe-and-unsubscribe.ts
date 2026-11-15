const listeners = new Set<(n: number) => void>();
function subscribe(f: (n: number) => void) { listeners.add(f); return () => listeners.delete(f); }
function emit(n: number) { for (const f of listeners) f(n); }
let heard = 0;
const stop = subscribe(n => { heard += n; });
const stopSecond = subscribe(n => { heard += n * 10; });
emit(1);
const first = stop();
emit(2);
console.log(heard, first, stop(), listeners.size, stopSecond(), listeners.size);
