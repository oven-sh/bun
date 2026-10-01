// Stand-ins for the functions of the jsc shell that JSTests/stress uses. Tier-control functions do nothing: what is compared is behaviour.
import * as jsc from "bun:jsc";
const g = globalThis, nop = () => {};
for (const name of ["noInline", "noDFG", "noFTL", "neverInlineFunction", "noOSRExitFuzzing", "optimizeNextInvocation", "ensureArrayStorage", "setNeverInline", "setNeverOptimize", "failNextNewCodeBlock", "disableRichSourceInfo"])
    g[name] = nop;
g.testLoopCount = 10000;
g.print = (...a) => console.log(...a);
g.printErr = (...a) => console.error(...a);
g.debug = g.print;
g.gc = g.fullGC = () => { Bun.gc(true); };
g.edenGC = () => { jsc.edenGC(); };
g.drainMicrotasks = () => { jsc.drainMicrotasks(); };
g.isFinalTier = () => true;
g.jscOptions = () => ({});
g.sleepSeconds = nop;
g.preciseTime = () => performance.now() / 1000;
g.currentCPUTime = g.preciseTime;
