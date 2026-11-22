// What a helper does behind a return on an arm it does not always do, whatever that return gives back; the body of a generator does not run at the call, and that of an async function runs on later. The constructor's own store is then the first that every construction runs, and its form stands.
// RUN(LIST): link
// LIST: layout {{*}}kind=Instance name="HelperMayReturnList" {{*}}key="mark"
// LIST-NOT: layout {{*}}kind=Instance name="HelperMayReturnList" {{*}}form=[
// RUN(MADE): link
// MADE: layout {{*}}kind=Instance name="HelperMayReturnMade" {{*}}key="mark"
// MADE-NOT: layout {{*}}kind=Instance name="HelperMayReturnMade" {{*}}form=[
// RUN(GENERATOR): link
// GENERATOR: layout {{*}}kind=Instance name="HandsToGenerator" {{*}}key="mark"
// GENERATOR-NOT: layout {{*}}kind=Instance name="HandsToGenerator" {{*}}form=[
// RUN(ASYNC): link
// ASYNC: layout {{*}}kind=Instance name="HandsToAsync" {{*}}key="mark"
// ASYNC-NOT: layout {{*}}kind=Instance name="HandsToAsync" {{*}}form=[
// RUN(ALWAYS): link
// ALWAYS: layout {{*}}kind=Instance name="HelperDefinesFirst" {{*}}key="mark" {{*}}form=[IsNotEnumerable]

function tagOrReturnList(row, hidden) {
  if (!hidden) return [];
  Object.defineProperty(row, "mark", { value: 0, writable: true, configurable: true });
  return [];
}
class HelperMayReturnList {
  constructor(n, hidden) {
    tagOrReturnList(this, hidden);
    this.mark = n;
  }
}
function tagOrReturnMade(row, hidden) {
  if (!hidden) return new Map();
  Object.defineProperty(row, "mark", { value: 0, writable: true, configurable: true });
  return new Map();
}
class HelperMayReturnMade {
  constructor(n, hidden) {
    tagOrReturnMade(this, hidden);
    this.mark = n;
  }
}
function* tagWhenStepped(row) {
  Object.defineProperty(row, "mark", { value: 0, writable: true, configurable: true });
}
class HandsToGenerator {
  constructor(n) {
    tagWhenStepped(this);
    this.mark = n;
  }
}
async function tagLater(row) {
  await null;
  Object.defineProperty(row, "mark", { value: 0, writable: true, configurable: true });
}
class HandsToAsync {
  constructor(n) {
    tagLater(this);
    this.mark = n;
  }
}
function tagThenReturnList(row, hidden) {
  Object.defineProperty(row, "mark", { value: 0, writable: true, configurable: true });
  if (!hidden) return [];
  return [row];
}
class HelperDefinesFirst {
  constructor(n, hidden) {
    tagThenReturnList(this, hidden);
    this.mark = n;
  }
}
globalThis.keep = [
  new HelperMayReturnList(1, false),
  new HelperMayReturnList(2, true),
  new HelperMayReturnMade(3, false),
  new HelperMayReturnMade(4, true),
  new HandsToGenerator(5),
  new HandsToAsync(6),
  new HelperDefinesFirst(7, false),
  new HelperDefinesFirst(8, true),
];
console.log(globalThis.keep.map(row => row.constructor.name + ":" + Object.keys(row).join() + ":" + row.mark).join(" "));
