// Closures that must stay heap-allocated because the function they are passed to keeps, returns, stores or inspects them.
const kept: ((x: number) => number)[] = [];
function keeps(f: (x: number) => number): number { kept.push(f); if (kept.length > 1e9) return keeps(f); return f(1); }
function returns(f: (x: number) => number): (x: number) => number { if (kept.length > 1e9) return returns(f); f(1); return f; }
function looksInto(f: (x: number) => number): number { if (kept.length > 1e9) return looksInto(f); return f.length + f(1); }
function captures(f: (x: number) => number): () => number { if (kept.length > 1e9) return captures(f); return () => f(2); }
function handedToKeeper(n: number): number { //! heap
  let total = n;
  return keeps(x => { total += x; return total; }); //! heap
}
function handedToReturner(n: number): number { //! heap
  let total = n;
  return returns(x => { total += x; return total; })(5); //! heap
}
function handedToLooker(n: number): number { //! heap
  let total = n;
  return looksInto(x => { total += x; return total; }); //! allocated at 2 sites
}
function handedToCapturer(n: number): number { //! heap
  let total = n;
  return captures(x => { total += x; return total; })(); //! allocated at 2 sites
}
function calls(f: () => unknown): unknown { if (kept.length > 1e9) return calls(f); return f(); }
function namesItself(n: number): boolean {
  let total = n;
  const f = function g(): unknown { total++; return g; }; //! heap
  return calls(f) === f && total === n + 1;
}
function heldByItsOwnEnvironment(n: number): boolean { //! heap
  let total = n;
  const f = (): unknown => { total++; return f; }; //! heap
  return calls(f) === f && total === n + 1;
}
let out = "";
for (let i = 0; i < 200; i++) {
  const a = handedToKeeper(i), b = handedToReturner(i), c = handedToLooker(i), d = handedToCapturer(i), e = namesItself(i), g = heldByItsOwnEnvironment(i);
  if (i % 50 === 0) out += a + "|" + b + "|" + c + "|" + d + "|" + e + "|" + g + "\n";
}
let later = 0;
for (let i = 0; i < kept.length; i++) later += kept[i](1);
console.log(out + later);
