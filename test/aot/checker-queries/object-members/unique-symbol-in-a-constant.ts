// In a compile build a constant that is initialized with a unique symbol keeps it, so a member under that key is found through the constant. A variable that can change holds a `symbol`.
const kState = Symbol("state");
const names: { kState: typeof kState } = { kState };
class Holder {
  [kState] = 1;
}
const kCopied = kState;
const { kState: kTaken } = names;
let kChanging = kState;
function take({ kState: kParameter }: typeof names) {
  return kParameter;
}
export function read(holder: Holder) {
  kChanging = Symbol("other");
  return [holder[kCopied], holder[kTaken], kChanging, take(names)];
}
