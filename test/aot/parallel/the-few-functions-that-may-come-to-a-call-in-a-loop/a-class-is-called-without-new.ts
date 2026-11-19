// One of the two that may be called is a class, which throws where it is called without new.
// STATISTIC: CallsDispatchedByCallee >= 1
class Ash { k = 1; } function plain() { return { k: 2 }; }
let sum = 0, refused = 0;
for (let i = 0; i < 1000; i++) { const make: any = i & 1 ? Ash : plain; try { const made = make(); sum += made.k; } catch (e: any) { refused += e.constructor === TypeError ? 1 : 1000; } }
console.log(sum, refused);
