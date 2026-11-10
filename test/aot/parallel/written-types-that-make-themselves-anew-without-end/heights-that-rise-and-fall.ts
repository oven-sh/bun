type Wave<T, Up> = { v: T; next?: Up extends true ? Wave<[[T]], false> : Wave<T extends [infer U] ? U : never, true> };
const wave: Wave<"a", true> = { v: "a", next: { v: [["a"]], next: { v: ["a"], next: { v: [[["a"]]], next: { v: [["a"]] } } } } };
console.log(wave.v, wave.next?.v[0][0], wave.next?.next?.v[0], wave.next?.next?.next?.next?.v[0][0]);
export {};
