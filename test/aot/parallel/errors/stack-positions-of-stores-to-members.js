// Prints where a stack trace places a store to a member that is a target of an assignment pattern or stands in the head of a loop.
function pass(value) {
  return value;
}
const nothing = null;
const holder = { inner: null, text: "text", list: [1], deep: { inner: null }, make() { return { made: 1 }; }, set refused(value) { throw new Error("refused"); } };
const key = "absent";
const inThisFile = /stack-positions-of-stores-to-members/;
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    const places = String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
    console.log(label, "|", error.constructor.name, "|", places.slice(0, -2).join(" "));
  }
}
show("list, a setter", () => { [holder.refused] = [1]; });
show("list, a setter, from a call", () => { [holder.refused] = pass([1]); });
show("list, a setter, from a member", () => { [holder.refused] = holder.list; });
show("list, a setter second", () => { [holder.text, holder.refused] = [1, 2]; });
show("list, a setter behind a name", () => { let first; [first, holder.refused] = [1, 2]; });
show("list, a member of null", () => { [nothing.member] = [1]; });
show("list, a member of an inner null", () => { [holder.inner.member] = [1]; });
show("list, a member of a deeper null", () => { [holder.deep.inner.member] = [1]; });
show("list, a member under a key", () => { [holder[key].member] = [1]; });
show("list, a setter under a text", () => { [holder["refused"]] = [1]; });
show("list, a setter with a default", () => { [holder.refused = 1] = []; });
show("list, the rest goes to a setter", () => { [...holder.refused] = []; });
show("list, the rest behind a member", () => { [holder.text, ...holder.refused] = []; });
show("list in a list", () => { [[holder.refused]] = [[1]]; });
show("object in a list", () => { [{ a: holder.refused }] = [{ a: 1 }]; });
show("list in an object", () => { ({ a: [holder.refused] } = { a: [1] }); });
show("object, a setter", () => { ({ a: holder.refused } = { a: 1 }); });
show("object, a setter second", () => { ({ a: holder.text, b: holder.refused } = { a: 1 }); });
show("object, a member of null", () => { ({ a: nothing.member } = { a: 1 }); });
show("object, a longer member of null", () => { ({ a: nothing.aLongerMember } = { a: 1 }); });
show("object, a member of an inner null", () => { ({ a: holder.inner.member } = { a: 1 }); });
show("object, a member of a deeper null", () => { ({ a: holder.deep.inner.member } = { a: 1 }); });
show("object, a member under a key", () => { ({ a: holder[key].member } = { a: 1 }); });
show("object, an element of null", () => { ({ a: holder.inner[key] } = { a: 1 }); });
show("object, an element of an element", () => { ({ a: holder[key][key] } = { a: 1 }); });
show("object, a setter under a text", () => { ({ a: holder["refused"] } = { a: 1 }); });
show("object, a setter in parentheses", () => { ({ a: (holder.refused) } = { a: 1 }); });
show("object, a setter with a default", () => { ({ a: holder.refused = 1 } = {}); });
show("object, a setter under a computed key", () => { ({ [key]: holder.refused } = { a: 1 }); });
show("object, a member of what a call made", () => { ({ a: holder.make().absent.member } = { a: 1 }); });
show("object, the rest goes to a setter", () => { ({ ...holder.refused } = {}); });
show("object, the rest behind a member", () => { ({ a: holder.text, ...holder.refused } = {}); });
show("for-of, a setter", () => { for (holder.refused of [1]) {} });
show("for-of, a member of null", () => { for (nothing.member of [1]) {} });
show("for-of, a member of an inner null", () => { for (holder.inner.member of [1]) {} });
show("for-of, a list", () => { for ([holder.refused] of [[1]]) {} });
show("for-of, a list with a member of null", () => { for ([nothing.member] of [[1]]) {} });
show("for-of, an object", () => { for ({ a: holder.refused } of [{ a: 1 }]) {} });
show("for-of, an object with a member of null", () => { for ({ a: nothing.member } of [{ a: 1 }]) {} });
show("for-in, a setter", () => { for (holder.refused in { a: 1 }) {} });
show("for-in, a member of null", () => { for (nothing.member in { a: 1 }) {} });
show("for-in, a member of an inner null", () => { for (holder.inner.member in { a: 1 }) {} });
