function outer() {
  function mark(action) { action.count = (action.count || 0) + 1; return action.count; }
  function visit() {}
  function ask() { return mark(visit); }
  return [ask(), ask(), mark(visit)].join();
}
console.log(outer());
