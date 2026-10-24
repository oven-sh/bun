const item = { n: 1 };
const other = { n: 2 };
const same = value => value;
function show(label, value) {
  console.log(label, typeof value, value === item, value === other);
}

show("spread of map", [...[item, other].values().map(same)][0]);
show("toArray of map", [item, other].values().map(same).toArray()[1]);
show("spread of filter", [...[item, other].values().filter(value => value === other)][0]);
show("toArray of take", [item, other].values().take(1).toArray()[0]);
show("spread of drop", [...[item, other].values().drop(1)][0]);
show("spread of flatMap", [...[item].values().flatMap(value => [value, other])][1]);

const step = [item, other].values().filter(() => true).next();
console.log("step", typeof step, Object.keys(step).join(), step.done);
show("value of a step", step.value);

const doubled = [...[1, 2].values().map(value => value * 2)];
console.log("numbers", doubled.length, doubled.join(), doubled[0] + 1);
for (const number of doubled) console.log(number + 1);

const called = [() => 21, () => 42].values().drop(1).next();
console.log("function", typeof called, called.done, called.value());

const empty = [].values().map(same);
const last = empty.next();
console.log("completed", last.done, last.value, JSON.stringify(empty.next()));

const closed = [item].values().map(same);
console.log("closed", JSON.stringify(closed.return()), JSON.stringify(closed.next()));
const started = [item, other].values().map(same);
show("before return", started.next().value);
console.log("return", JSON.stringify(started.return()), JSON.stringify(started.next()));

function* twice() {
  yield item;
  return other;
}
const byHand = twice();
show("yielded", byHand.next().value);
const returned = byHand.next();
console.log("returned", returned.done);
show("returned value", returned.value);
const after = byHand.next();
console.log("after the end", after.done, after.value);
show("over a generator", [...twice().map(same)][0]);
show("over a set", [...new Set([other]).values().map(same)][0]);
show("for-of", (() => { for (const value of [item].values().map(same)) return value; })());
show("Array.from", Array.from([other].values().map(same))[0]);
const [first] = [item].values().map(same);
show("pattern", first);
