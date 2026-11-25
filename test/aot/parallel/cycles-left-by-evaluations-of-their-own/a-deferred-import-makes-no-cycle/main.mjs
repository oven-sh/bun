import { touch, ok } from "./keeper.mjs";
try { console.log("touch:", touch()); } catch (error) { console.log("touch threw:", error.message); }
try { console.log("touch again:", touch()); } catch (error) { console.log("touch again threw:", error.message); }
console.log("keeper:", ok);
const again = await import("./keeper.mjs").then(it => "fulfilled " + it.ok, error => "rejected " + error.message);
console.log("keeper again:", again);
