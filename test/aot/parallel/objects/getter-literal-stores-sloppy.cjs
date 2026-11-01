// Sloppy code: a store onto a getter alone is dropped without a word.
var hidden = function (text) { return text.split("~").join(""); };
var handBack = new Function("value", hidden("ret~urn value"));
function attempt(what, run) {
  try {
    console.log(what, JSON.stringify(run()));
  } catch (error) {
    console.log(what, "throws", error.constructor.name);
  }
}
function describe(made, key) {
  var found = Object.getOwnPropertyDescriptor(made, key);
  return [typeof found.get, typeof found.set, found.value === undefined ? null : found.value, found.enumerable, found.configurable, Object.keys(made).join()];
}
attempt("is this sloppy code", function () { return this === undefined ? "no" : "yes"; });
attempt("store onto a getter alone", function () {
  var made = { get first() { return this.lead + 1; }, lead: 1, only1: 0 };
  made[handBack("first")] = 5;
  return [made.first, describe(made, "first")];
});
attempt("store by name onto a getter alone where a key nobody knows is stored too", function () {
  var made = { get first() { return this.lead + 1; }, lead: 1, only2: 0 };
  made[handBack("lead")] = 3;
  made[handBack("first")] = 5;
  return [made.first, describe(made, "first")];
});
attempt("store onto a getter and a setter", function () {
  var made = { get first() { return this.lead + 1; }, set first(value) { this.lead = value * 10; }, lead: 1, only3: 0 };
  made[handBack("first")] = 5;
  return [made.first, made.lead, describe(made, "first")];
});
attempt("assign onto a getter alone", function () {
  var made = { get first() { return this.lead + 1; }, lead: 1, only4: 0 };
  Object.assign(made, handBack({ first: 5 }));
  return [made.first, describe(made, "first")];
});
attempt("stores in a loop over the keys of a source nobody knows", function () {
  var made = { get first() { return this.lead + 1; }, lead: 1, only5: 0 };
  var source = handBack({ first: 5, lead: 6, other: 7 });
  for (var key in source) made[key] = source[key];
  return [made.first, made.lead, made.other, describe(made, "first")];
});
attempt("read often, stored onto, read again", function () {
  var made = { get first() { return this.lead + 1; }, lead: 1, only6: 0 };
  var sum = 0;
  for (var turn = 0; turn < 300; turn++) {
    sum += made.first + made.lead;
    if (turn === 150) made[handBack("first")] = 100;
  }
  return [sum, describe(made, "first")];
});
attempt("a store into an heir of a getter alone", function () {
  var made = { get first() { return this.lead + 1; }, lead: 1, only7: 0 };
  var heir = Object.create(made);
  heir[handBack("first")] = 5;
  return [heir.first, Object.keys(heir).join()];
});
attempt("deleted, then stored", function () {
  var made = { get first() { return this.lead + 1; }, lead: 1, only8: 0 };
  delete made[handBack("first")];
  made[handBack("first")] = 7;
  return [made.first, describe(made, "first")];
});
