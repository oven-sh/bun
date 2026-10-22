// What built ins make: programs w socket address plain. It prints what plain Bun prints.
// @ts-nocheck
import { SocketAddress } from "node:net";
console.log(new SocketAddress({ address: "127.0.0.1", port: 80 }).port);
