let work = 0;
class Ring {
  even(n) { for (let i = 0; i < 2; i++) work = (work + i) | 0; if (n === 0) return 1; return this.odd(n - 1); }
  odd(n) { for (let i = 0; i < 2; i++) work = (work ^ i) | 0; if (n === 0) return 0; return this.even(n - 1); }
}
const ring = new Ring();
console.log([3].map(ring.odd, ring).join());
let answer; try { answer = ring.even(4000000); } catch (error) { answer = error.constructor.name; }
console.log(answer);
