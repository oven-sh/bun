// A parse that ends by a throw is closed: the parses that follow, deeper on the stack too, are still made by the generated parser.
declare const aotOperationCount: undefined | ((name: string) => number);
interface Wide { m0: string; m1: string; m2: string; m3: string; m4: string; m5: string; m6: string; m7: string; m8: string; m9: string; m10: string; m11: string; m12: string; m13: string; m14: string; m15: string; m16: string; m17: string; m18: string; m19: string; m20: string; m21: string; m22: string; m23: string; m24: string; m25: string; m26: string; m27: string; m28: string; m29: string; m30: string; m31: string; m32: string; m33: string; m34: string; m35: string; m36: string; m37: string; m38: string; m39: string; m40: string; m41: string; m42: string; m43: string; m44: string; m45: string; m46: string; m47: string; m48: string; m49: string; m50: string; m51: string; m52: string; m53: string; m54: string; m55: string; m56: string; m57: string; m58: string; m59: string; m60: string; m61: string; m62: string; m63: string; m64: string; m65: string; m66: string; m67: string; m68: string; m69: string; m70: string; m71: string; m72: string; m73: string; m74: string; m75: string; m76: string; m77: string; m78: string; m79: string; m80: string; m81: string; m82: string; m83: string; m84: string; m85: string; m86: string; m87: string; m88: string; m89: string; m90: string; m91: string; m92: string; m93: string; m94: string; m95: string; m96: string; m97: string; m98: string; m99: string; m100: string; m101: string; m102: string; m103: string; m104: string; m105: string; m106: string; m107: string; m108: string; m109: string; m110: string; m111: string; m112: string; m113: string; m114: string; m115: string; m116: string; m117: string; m118: string; m119: string; }
interface Narrow { n: number }
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const readAgain = () => (counted ? counted("operationAOTJSONSourceAbandon") : 0);
const wideText = '{"m0":"0","m1":"1","m2":"2","m3":"3","m4":"4","m5":"5","m6":"6","m7":"7","m8":"8","m9":"9","m10":"10","m11":"11","m12":"12","m13":"13","m14":"14","m15":"15","m16":"16","m17":"17","m18":"18","m19":"19","m20":"20","m21":"21","m22":"22","m23":"23","m24":"24","m25":"25","m26":"26","m27":"27","m28":"28","m29":"29","m30":"30","m31":"31","m32":"32","m33":"33","m34":"34","m35":"35","m36":"36","m37":"37","m38":"38","m39":"39","m40":"40","m41":"41","m42":"42","m43":"43","m44":"44","m45":"45","m46":"46","m47":"47","m48":"48","m49":"49","m50":"50","m51":"51","m52":"52","m53":"53","m54":"54","m55":"55","m56":"56","m57":"57","m58":"58","m59":"59","m60":"60","m61":"61","m62":"62","m63":"63","m64":"64","m65":"65","m66":"66","m67":"67","m68":"68","m69":"69","m70":"70","m71":"71","m72":"72","m73":"73","m74":"74","m75":"75","m76":"76","m77":"77","m78":"78","m79":"79","m80":"80","m81":"81","m82":"82","m83":"83","m84":"84","m85":"85","m86":"86","m87":"87","m88":"88","m89":"89","m90":"90","m91":"91","m92":"92","m93":"93","m94":"94","m95":"95","m96":"96","m97":"97","m98":"98","m99":"99","m100":"100","m101":"101","m102":"102","m103":"103","m104":"104","m105":"105","m106":"106","m107":"107","m108":"108","m109":"109","m110":"110","m111":"111","m112":"112","m113":"113","m114":"114","m115":"115","m116":"116","m117":"117","m118":"118","m119":"119"}';
const narrowText = '{"n":7}';
let thrown = 0;
let followed = 0;
let sum = 0;

function parseNarrow(): number {
  return JSON.parse<Narrow>(narrowText).n;
}
function parseWide(): number {
  return JSON.parse<Wide>(wideText).m0.length;
}
function attempt(): void {
  try {
    sum += parseWide();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    thrown++;
    try {
      sum += parseNarrow();
      followed++;
    } catch (second) {
      if (!(second instanceof RangeError)) throw second;
    }
  }
}
function descend(levels: number, attemptsFrom: number): number {
  if (levels >= attemptsFrom) attempt();
  try {
    return descend(levels + 1, attemptsFrom) + 0;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return levels;
  }
}

sum += parseWide() + parseNarrow();
const before = readAgain();
const deepest = descend(0, Infinity);
descend(0, deepest - 200);
console.log("the parses behind a parse that threw were made by the generated parser:", counted ? thrown > 0 && followed > 0 && readAgain() === before : true);
console.log(parseWide() + parseNarrow());
