type Swap<T, U> = { t: T; next?: Swap<U, [[T]]> };
const swap: Swap<"a", "b"> = { t: "a", next: { t: "b", next: { t: [["a"]], next: { t: [["b"]], next: { t: [[[["a"]]]] } } } } };
console.log(swap.t, swap.next?.t, swap.next?.next?.t[0][0], swap.next?.next?.next?.next?.t[0][0][0][0]);
export {};
