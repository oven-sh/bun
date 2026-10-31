// `bun run` decides more tests of an `if` than the build does, and removes a `let`, a `const` and a class behind a branch that returns: a `--define` whose value is such a name finds what lies further out. The build finds the declaration and stops at the defined name.
// Flags: --define TYPEOF=kind --define HOT=hot --define LENGTH=size --define INDEX=first --define CODE=code --define ITEM=item --define MADE=made --define LIST=list --define EITHER=either --define LAST=last --define CHOSEN=chosen --define OTHERWISE=otherwise
const names = ["kind", "hot", "size", "first", "code", "item", "made", "list", "either", "last", "chosen", "otherwise"];
for (const name of names) {
  globalThis[name] = "the global";
}
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
}
function behindATypeof(value) {
  if (typeof value) return TYPEOF;
  const kind = 1;
}
function behindImportMetaHot() {
  if (!import.meta.hot) return HOT;
  const hot = 1;
}
function behindTheLengthOfAString() {
  if ("ab".length > 1) return LENGTH;
  let size = 1;
}
function behindACharacterOfAString() {
  if ("abc"[0]) return INDEX;
  let first = 1;
}
function behindACharacterCode() {
  if ("a".charCodeAt(0)) return CODE;
  const code = 1;
}
function behindAnElementOfAnArray() {
  if ([1][0]) return ITEM;
  const item = 1;
}
function behindANewObject() {
  if (new Object()) return MADE;
  class made {}
}
function behindANewArray() {
  if (new Array()) return LIST;
  class list {}
}
function behindAnOr(value) {
  if (value || typeof value) return EITHER;
  const either = 1;
}
function behindAComma(value) {
  if ((value, typeof value)) return LAST;
  let last = 1;
}
function behindAConditional(value) {
  if (typeof value ? 1 : 0) return CHOSEN;
  const chosen = 1;
}
function inTheOtherBranch(value) {
  if (!typeof value) {
  } else return OTHERWISE;
  class otherwise {}
}
console.log(
  attempt(behindATypeof),
  attempt(behindImportMetaHot),
  attempt(behindTheLengthOfAString),
  attempt(behindACharacterOfAString),
  attempt(behindACharacterCode),
  attempt(behindAnElementOfAnArray),
  attempt(behindANewObject),
  attempt(behindANewArray),
  attempt(behindAnOr),
  attempt(behindAComma),
  attempt(behindAConditional),
  attempt(inTheOtherBranch),
);
/* Build errors:
error: TS100050: --aot does not support --define TYPEOF=kind where "kind" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'TYPEOF="kind"'
error: TS100050: --aot does not support --define HOT=hot where "hot" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'HOT="hot"'
error: TS100050: --aot does not support --define LENGTH=size where "size" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'LENGTH="size"'
error: TS100050: --aot does not support --define INDEX=first where "first" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'INDEX="first"'
error: TS100050: --aot does not support --define CODE=code where "code" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'CODE="code"'
error: TS100050: --aot does not support --define ITEM=item where "item" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'ITEM="item"'
error: TS100050: --aot does not support --define MADE=made where "made" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'MADE="made"'
error: TS100050: --aot does not support --define LIST=list where "list" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'LIST="list"'
error: TS100050: --aot does not support --define EITHER=either where "either" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'EITHER="either"'
error: TS100050: --aot does not support --define LAST=last where "last" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'LAST="last"'
error: TS100050: --aot does not support --define CHOSEN=chosen where "chosen" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'CHOSEN="chosen"'
error: TS100050: --aot does not support --define OTHERWISE=otherwise where "otherwise" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'OTHERWISE="otherwise"'
*/
