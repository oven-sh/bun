let work = 0;
class Parity {
  static even(n: number): number { for (let i = 0; i < 2; i++) work = (work + i) | 0; if (n === 0) return 1; return Parity.odd(n - 1); }
  static odd(n: number): number { for (let i = 0; i < 2; i++) work = (work ^ i) | 0; if (n === 0) return 0; return Parity.even(n - 1); }
}
console.log([3].map(Parity.odd).join());
let answer: unknown; try { answer = Parity.even(4000000); } catch (error: any) { answer = error.constructor.name; }
console.log(answer);
