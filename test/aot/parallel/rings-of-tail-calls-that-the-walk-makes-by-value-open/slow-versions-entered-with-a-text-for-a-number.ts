function even(n: number, step: number): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; if (n <= 0) return work; return odd(n - step, step); }
function odd(n: number, step: number): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; if (n <= 0) return (work + 1) | 0; return even(n - step, step); }
console.log(even(1000000, 1));
let answer: number | string; try { answer = even(1000000, "1" as unknown as number); } catch (e) { answer = (e as Error).constructor.name; }
console.log(answer);
