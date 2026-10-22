import { BlockList, SocketAddress } from "node:net";
import { bench, group, run } from "../runner.mjs";

const addresses = Array.from(
  { length: 20_000 },
  (_, i) => new SocketAddress({ address: `10.${i >> 16}.${(i >> 8) & 255}.${i & 255}` }),
);
const miss = new SocketAddress({ address: "203.0.113.7" });

for (const count of [8, 1_000, 20_000]) {
  const list = new BlockList();
  for (let i = 0; i < count; i++) list.addAddress(addresses[i]);
  const oldest = addresses[0];
  const newest = addresses[count - 1];

  group(`check() on ${count} addresses`, () => {
    bench("miss", () => list.check(miss));
    bench("hit on the oldest rule", () => list.check(oldest));
    bench("hit on the newest rule", () => list.check(newest));
  });
}

for (const count of [8, 1_000, 20_000]) {
  group(`fill ${count} rules`, () => {
    bench("addAddress", () => {
      const list = new BlockList();
      for (let i = 0; i < count; i++) list.addAddress(addresses[i]);
    }).gc("inner");
    bench("addRange", () => {
      const list = new BlockList();
      for (let i = 0; i < count; i++) list.addRange(addresses[0], addresses[i]);
    }).gc("inner");
    bench("addSubnet", () => {
      const list = new BlockList();
      for (let i = 0; i < count; i++) list.addSubnet(addresses[i], 32);
    }).gc("inner");
  });
}

await run();
