// A control: what is called through super hands out nothing.
// STATISTIC: FunctionsLowered <= 1000
class Own extends EventTarget {
  forget(kind, listener) {
    return super.removeEventListener(kind, listener);
  }
}
console.log(new Own().forget("ping", () => {}));
