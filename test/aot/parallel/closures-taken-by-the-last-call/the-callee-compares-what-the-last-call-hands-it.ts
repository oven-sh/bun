let before: unknown;
function same(f: () => number): boolean { const answer = f === before; before = f; return answer; }
function ask(k: number): boolean { return same(() => k); }
console.log(ask(1), ask(1), ask(2));
