import * as seenByEval from "./files/seen-by-eval.json"
export function readByEval() {
  return eval("seenByEval.secret + ' ' + Object.keys(seenByEval).sort().join()")
}
