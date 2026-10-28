// Built ins assorted, one probe of many. It prints what plain Bun prints.
import { getSystemErrorName } from "node:util";
import net from "node:net";
console.log(getSystemErrorName(-2), getSystemErrorName(-13), net.getDefaultAutoSelectFamily());
try { (getSystemErrorName as any)("x"); } catch (error) { console.log((error as any).code); }
try { getSystemErrorName(1); } catch (error) { console.log((error as any).code); }
Bun.sleepSync(0);
Bun.gc(true);
(Bun.gc as any)();
(Bun.gc as any)(1);
try { (Bun.sleepSync as any)("x"); } catch (error) { console.log((error as Error).name); }
try { Bun.sleepSync(-1); } catch (error) { console.log((error as Error).name); }
console.log("done");
