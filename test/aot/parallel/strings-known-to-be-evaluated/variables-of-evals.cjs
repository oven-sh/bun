// The names around a direct eval are looked for among the variables of evals once an eval of the file has declared some.
globalThis.given = "global";
const log = [];
function none(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.max(i, given.length);
  if (n < 0) eval(late("1"));
  return total;
}
function late(text) { return process.argv.length ? text : ""; }
function declares(text) {
  const before = () => given + typeof Math + typeof later;
  const made = [before()];
  eval(late(text));
  made.push(before(), given, typeof later);
  return made.join();
}
function nested(text) {
  function inner() { eval(late(text)); return () => given; }
  const read = inner();
  return read() + given;
}
function deletes(text) {
  eval(late(text));
  const had = given;
  return had + (delete given) + given;
}
function assigns(text) {
  eval(late(text));
  given = "assigned";
  return given + globalThis.given;
}
log.push(none(5));
log.push(declares("1"));
log.push(none(3));
log.push(declares("var given = 'declared', Math = 1, later = 2"), declares("2"));
log.push(nested("var given = 'inner'"), nested("0"));
log.push(deletes("var given = 'deleted'"), assigns("var given = 'own'"), globalThis.given);
globalThis.given = "global";
log.push(assigns("0"), globalThis.given, none(4));
const late2 = text => eval(text);
log.push(late2("var given = 'arrow'; given"), given);
with ({ given: "with" }) log.push(given, (() => given + eval(late("given")))());
console.log(log.join("\n"));
