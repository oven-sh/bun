function outer(n) {
  let calls = 0;
  function ping(action, k) { return k ? pong(action, k - 1) : action(); }
  function pong(action, k) { return k ? ping(action, k - 1) : action(); }
  function visit() { return ++calls; }
  function ask() { return ping(visit, n); }
  return ask() + ask();
}
console.log(outer(3), outer(0));
