class Counter { static n = 0; static bump(times: number) { for (let i = 0; i < times; i++) this.n++; return this.n; } }
console.log(Counter.bump(4), Counter.n); const bump = Counter.bump; console.log(bump.call({ n: 10 } as any, 3), Counter.n);
export {};
