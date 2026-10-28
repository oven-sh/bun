// Optional chains and ?? over links that end in null or undefined.
interface Link {
  value?: number;
  next?: Link | null;
  method?(): number;
  items?: number[];
}
const chain: Link = { value: 1, next: { value: 2, method: () => 7, items: [9] } };
console.log(chain.next?.value, chain.next?.next?.value, chain.next?.next?.next!.value);
console.log(chain.method?.(), chain.next?.method?.(), chain.next?.items?.[0], chain.items?.[0]);
console.log(chain.next?.next ?? "none", chain.value ?? "unused", (chain.next?.next)?.value);
let calls = 0;
const side = () => ++calls;
chain.items?.[side()];
console.log(calls, delete chain.next?.next?.value);
let maybe: number | null = null;
maybe ??= 5;
maybe ||= 6;
maybe &&= 7;
console.log(maybe);
