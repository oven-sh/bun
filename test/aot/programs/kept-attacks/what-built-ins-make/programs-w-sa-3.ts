// What built ins make: programs w sa. It prints what plain Bun prints.
// @ts-nocheck
import { SocketAddress } from "node:net";
try { SocketAddress({}); } catch (e) { console.log(e.name); }
