// What built ins make: programs w socket address getter. It prints what plain Bun prints.
// @ts-nocheck
import { SocketAddress } from "node:net";
try { new SocketAddress({ get address() { throw new RangeError("from the getter"); } }); } catch (e) { console.log(e.name); }
