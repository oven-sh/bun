type Chain<K extends string> = { key: K; next?: Chain<`${K}a`> };
const chain: Chain<"a"> = { key: "a", next: { key: "aa", next: { key: "aaa", next: { key: "aaaa", next: { key: "aaaaa" } } } } };
console.log(chain.key, chain.next?.key, chain.next?.next?.next?.next?.key, chain.next?.next?.next?.next?.next);
export {};
