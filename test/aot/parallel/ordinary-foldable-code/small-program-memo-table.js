const SQUARES = {};
for (let i = 1; i <= 5; i++) SQUARES[i] = i * i;
const PRIMES = [2, 3, 5, 7, 11];
const isPrime = (n) => PRIMES.includes(n);
console.log(SQUARES, Object.keys(SQUARES).filter((k) => isPrime(Number(k))));
