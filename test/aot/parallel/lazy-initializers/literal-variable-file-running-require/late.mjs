import { count } from "./first.mjs";
const seen = typeof count;
const kept = { first: count, list: [count, 2, 3], inner: { deep: count, more: [4, 5] }, last: { z: 1 } };
setTimeout(() => console.log(seen, String(kept.first), String(kept.list[0]), String(kept.inner.deep)));
