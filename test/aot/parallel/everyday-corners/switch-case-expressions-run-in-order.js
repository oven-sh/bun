// Switch case expressions run in order: compiled answers as plain.
const log = [];
const c = v => (log.push(v), v);
function s(x) {
  switch (x) {
    case c(1):
      return "a";
    case c(2):
      return "b";
    case c(3):
      return "c";
  }
  return "none";
}
console.log(s(2), s(9), log.join());
