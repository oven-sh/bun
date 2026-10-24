// Sloppy code. Accessors put on a literal by __defineSetter__ and __defineGetter__ under names that come out of a list hand on to a member of the receiver. They are found by name and by key
// from objects made by Object.create. A setter's result is dropped, a setter that throws is seen, a setter that changes the chain it was found on is called once.
const log = [];
const context = { kind: "context" };
function handOn(holder, target, name) {
  holder.__defineGetter__(name, function () {
    return this[target][name];
  });
  holder.__defineSetter__(name, function (value) {
    log.push("hands on " + name);
    return (this[target][name] = value);
  });
}
for (const name of ["body", "status"]) handOn(context, "answer", name);
const application = Object.create(context);
function make() {
  const made = Object.create(application);
  made.answer = { body: null, status: 404 };
  return made;
}
function storeByName(object, value) {
  return (object.body = value);
}
function storeByKey(object, key, value) {
  return (object[key] = value);
}
for (let i = 0; i < 60; i++) {
  storeByName(make(), i);
  storeByKey(make(), i & 1 ? "body" : "status", i);
}
log.length = 0;
let current = make();
log.push("the value of the assignment " + storeByName(current, "text") + " " + current.answer.body + " " + Object.keys(current));
log.push("by key " + storeByKey(current, "status", 200) + " " + current.answer.status + " " + current.status);
context.__defineSetter__("body", function (value) {
  throw new RangeError("refused " + value);
});
try {
  storeByName(make(), 1);
} catch (error) {
  log.push(error.name + " " + error.message);
}
context.__defineSetter__("body", function (value) {
  log.push("removes itself " + value);
  delete context.body;
});
current = make();
storeByName(current, 2);
log.push("behind the first " + Object.keys(current));
storeByName(current, 3);
log.push("behind the second " + Object.keys(current) + " " + current.body);
current = make();
storeByName(current, 4);
log.push("a new object " + Object.keys(current) + " " + current.body);
context.__defineGetter__("body", function () {
  return "a getter alone";
});
current = make();
log.push("ignored in sloppy code " + storeByName(current, 5) + " " + current.body + " " + Object.keys(current));
console.log(log.join("\n"));
