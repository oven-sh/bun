type Hook = () => number;
(globalThis as unknown as { hook: Hook }).hook = (): number => require("./outside.mts").seen;
try { console.log("first:", String(require("./first.mts").ok)); } catch (error) { console.log("first:", (error as Error).message); }
try { console.log("second:", String(require("./second.mts").ok)); } catch (error) { console.log("second:", (error as Error).message); }
