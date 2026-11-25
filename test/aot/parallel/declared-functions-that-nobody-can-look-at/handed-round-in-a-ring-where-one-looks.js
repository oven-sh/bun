function outer(n) {
  let last;
  function ping(action, k) { return k ? pong(action, k - 1) : action(); }
  function pong(action, k) { const was = last; last = action; return k ? ping(action, k - 1) : was === action; }
  function visit() { return "called"; }
  function ask() { return ping(visit, n); }
  return [ask(), ask()].join();
}
console.log(outer(1), outer(3), outer(2));
