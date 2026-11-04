function make(step) {
  let work = 0;
  function even(n) { for (let i = 0; i < 2; i++) work = (work + i) | 0; if (n === 0) return 1; return odd(n - step); }
  function odd(n) { for (let i = 0; i < 2; i++) work = (work ^ i) | 0; if (n === 0) return 0; return even(n - step); }
  return { even, first: [3].map(odd).join() };
}
const made = make(1);
console.log(made.first);
let answer; try { answer = made.even(4000000); } catch (error) { answer = error.constructor.name; }
console.log(answer);
