// What built ins make: programs w sa. It prints what plain Bun prints.
// @ts-nocheck
import { SocketAddress } from "node:net";
const attempt = run => { try { return run(); } catch (e) { return e.name; } };
console.log(attempt(() => SocketAddress({})));
