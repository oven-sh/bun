// A source is closed where the throw passes its frame: the parses that follow a parse that ended by a throw, deeper on the stack too, are still made by the generated parser, however many have thrown.
// The parser of Wide takes a large frame, so near the end of the stack its call throws where that of Narrow still has room.
// Flags: --aot-limit=MaxOpenJSONSources:2
// Env: JSC_aotCountsPath=/dev/null
declare const aotOperationCount: undefined | ((name: string) => number);
declare const aotRuntimeCounters: undefined | (() => string);
interface Wide { m0: string; m1: string; m2: string; m3: string; m4: string; m5: string; m6: string; m7: string; m8: string; m9: string; m10: string; m11: string; m12: string; m13: string; m14: string; m15: string; m16: string; m17: string; m18: string; m19: string; m20: string; m21: string; m22: string; m23: string; m24: string; m25: string; m26: string; m27: string; m28: string; m29: string; m30: string; m31: string; m32: string; m33: string; m34: string; m35: string; m36: string; m37: string; m38: string; m39: string; m40: string; m41: string; m42: string; m43: string; m44: string; m45: string; m46: string; m47: string; m48: string; m49: string; m50: string; m51: string; m52: string; m53: string; m54: string; m55: string; m56: string; m57: string; m58: string; m59: string; }
interface Narrow { n: number }
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const counters = typeof aotRuntimeCounters === "function" ? aotRuntimeCounters : null;
const opened = () => (counted ? counted("operationAOTJSONSourceOpen") : 0);
const readAgain = () => (counted ? counted("operationAOTJSONSourceAbandon") : 0);
// How often a parse found as many sources open as may be, and so was left to the engine's parser.
const refused = () => (counters ? Number(/^(\d+)\tlimit:MaxOpenJSONSources$/m.exec(counters())![1]) : 0);
const wideText = '{"m0":"0","m1":"1","m2":"2","m3":"3","m4":"4","m5":"5","m6":"6","m7":"7","m8":"8","m9":"9","m10":"10","m11":"11","m12":"12","m13":"13","m14":"14","m15":"15","m16":"16","m17":"17","m18":"18","m19":"19","m20":"20","m21":"21","m22":"22","m23":"23","m24":"24","m25":"25","m26":"26","m27":"27","m28":"28","m29":"29","m30":"30","m31":"31","m32":"32","m33":"33","m34":"34","m35":"35","m36":"36","m37":"37","m38":"38","m39":"39","m40":"40","m41":"41","m42":"42","m43":"43","m44":"44","m45":"45","m46":"46","m47":"47","m48":"48","m49":"49","m50":"50","m51":"51","m52":"52","m53":"53","m54":"54","m55":"55","m56":"56","m57":"57","m58":"58","m59":"59"}';
const narrowText = '{"n":7}';
let thrown = 0;
let followed = 0;
let sum = 0;

function parseNarrow(): number {
  return (JSON.parse(narrowText) as Narrow).n;
}
function parseWide(): number {
  return (JSON.parse(wideText) as Wide).m0.length;
}
function behindThrow(error: unknown): void {
  if (!(error instanceof RangeError)) throw error;
  thrown++;
  try {
    sum += parseNarrow();
    followed++;
  } catch (second) {
    if (!(second instanceof RangeError)) throw second;
  }
}
// The function that catches calls the one that parses, or parses itself.
function catchesForCallee(): void {
  try {
    sum += parseWide();
  } catch (error) {
    behindThrow(error);
  }
}
function catchesForItself(): void {
  try {
    sum += (JSON.parse(wideText) as Wide).m0.length;
  } catch (error) {
    behindThrow(error);
  }
}
function descend(levels: number, attemptsFrom: number, times: number, attempt: () => void): number {
  if (levels >= attemptsFrom) for (let i = 0; i < times; i++) attempt();
  try {
    return descend(levels + 1, attemptsFrom, times, attempt) + 0;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return levels;
  }
}

sum += parseWide() + parseNarrow();
const deepest = descend(0, Infinity, 0, catchesForCallee);
for (const attempt of [catchesForCallee, catchesForItself]) {
  for (const times of [1, 100]) {
    const [refusedBefore, thrownBefore, followedBefore] = [refused(), thrown, followed];
    descend(0, deepest - 200, times, attempt);
    console.log(attempt.name, times, "no parse deeper on the stack than those that threw found too many sources open:", counted ? thrown - thrownBefore >= times && followed > followedBefore && refused() === refusedBefore : true);
    const [openedBefore, againBefore] = [opened(), readAgain()];
    const narrow = parseNarrow();
    console.log(attempt.name, times, "and the next one is read once:", narrow, counted ? opened() - openedBefore === 1 && readAgain() === againBefore && refused() === refusedBefore : true);
  }
}
console.log(parseWide() + parseNarrow());
