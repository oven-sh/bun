type Count<N extends 0[]> = { n: N["length"]; next?: Count<[...N, 0]> };
const count: Count<[]> = { n: 0, next: { n: 1, next: { n: 2, next: { n: 3, next: { n: 4 } } } } };
console.log(count.n, count.next?.n, (count.next?.next?.next?.next?.n ?? 0) + 1);
export {};
