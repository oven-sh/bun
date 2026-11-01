// What Object.fromEntries and Object.groupBy answer is an ordinary object: whoever is handed it may define an accessor on it. An executable once died at the read behind that.
function define(object) {
  try { Object.defineProperty(object, "added", { get() { return 7; } }); } catch (error) { console.log(error.name); }
}
function defineByReflect(object) {
  try { console.log(Reflect.defineProperty(object, "added", { get() { return 8; } })); } catch (error) { console.log(error.name); }
}

const fromNoEntries = Object.fromEntries([]);
define(fromNoEntries);
console.log(fromNoEntries.added);

const noGroups = Object.groupBy([], value => value);
define(noGroups);
console.log(noGroups.added);

const oneGroup = Object.groupBy([1], () => "group");
define(oneGroup);
console.log(oneGroup.added, oneGroup.group);

const fromNoEntriesAgain = Object.fromEntries([]);
defineByReflect(fromNoEntriesAgain);
console.log(fromNoEntriesAgain.added);

const noGroupsAgain = Object.groupBy([], value => value);
defineByReflect(noGroupsAgain);
console.log(noGroupsAgain.added);

const fromOneEntry = Object.fromEntries([["own", 1]]);
define(fromOneEntry);
console.log(fromOneEntry.added, fromOneEntry.own);
