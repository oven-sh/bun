// A stack trace names a function by its `displayName` if that is a string that is not empty, as in plain Bun. A `name` that was redefined comes first.
function names(stack, ...candidates) {
  return candidates.filter(candidate => stack.includes(candidate)).join() || "neither";
}

function storedTo() { return new Error("x").stack; }
storedTo.displayName = "ShownForStore";
console.log(names(storedTo(), "storedTo", "ShownForStore"));

const arrowStoredTo = () => new Error("x").stack;
arrowStoredTo.displayName = "ShownForArrow";
console.log(names(arrowStoredTo(), "arrowStoredTo", "ShownForArrow"));

function definedOn() { return new Error("x").stack; }
Object.defineProperty(definedOn, "displayName", { value: "ShownForDefinition" });
console.log(names(definedOn(), "definedOn", "ShownForDefinition"));

function renamedFirst() { return new Error("x").stack; }
Object.defineProperty(renamedFirst, "name", { value: "RenamedOne" });
renamedFirst.displayName = "HiddenOne";
console.log(names(renamedFirst(), "renamedFirst", "RenamedOne", "HiddenOne"));

function renamedLast() { return new Error("x").stack; }
renamedLast.displayName = "HiddenTwo";
Object.defineProperty(renamedLast, "name", { value: "RenamedTwo" });
console.log(names(renamedLast(), "renamedLast", "RenamedTwo", "HiddenTwo"));

function givenNumber() { return new Error("x").stack; }
givenNumber.displayName = 12345;
console.log(names(givenNumber(), "givenNumber", "12345"));

function givenNothing() { return new Error("x").stack; }
givenNothing.displayName = "";
console.log(names(givenNothing(), "givenNothing"));

function storedToTwice() { return new Error("x").stack; }
storedToTwice.displayName = "FirstShown";
console.log(names(storedToTwice(), "storedToTwice", "FirstShown", "SecondShown"));
storedToTwice.displayName = "SecondShown";
console.log(names(storedToTwice(), "storedToTwice", "FirstShown", "SecondShown"));
storedToTwice.displayName = undefined;
console.log(names(storedToTwice(), "storedToTwice", "FirstShown", "SecondShown"));

function deletedFrom() { return new Error("x").stack; }
deletedFrom.displayName = "ShownUntilDeleted";
console.log(names(deletedFrom(), "deletedFrom", "ShownUntilDeleted"));
delete deletedFrom.displayName;
console.log(names(deletedFrom(), "deletedFrom", "ShownUntilDeleted"));

function withGetter() { return new Error("x").stack; }
Object.defineProperty(withGetter, "displayName", { get() { return "NeverAsked"; } });
console.log(names(withGetter(), "withGetter", "NeverAsked"));

function Constructed() { this.stack = new Error("x").stack; }
Constructed.displayName = "ShownForConstructor";
console.log(names(new Constructed().stack, "Constructed", "ShownForConstructor"));

class AssignedClass { constructor() { this.stack = new Error("x").stack; } }
AssignedClass.displayName = "ShownForClass";
console.log(names(new AssignedClass().stack, "AssignedClass", "ShownForClass"));

class StaticField { static displayName = "ShownForFieldOfClass"; constructor() { this.stack = new Error("x").stack; } }
console.log(names(new StaticField().stack, "StaticField", "ShownForFieldOfClass"));

const holder = { heldMethod() { return new Error("x").stack; } };
holder.heldMethod.displayName = "ShownForMethod";
console.log(names(holder.heldMethod(), "heldMethod", "ShownForMethod"));

const key = "displayName";
function storedToByKey() { return new Error("x").stack; }
storedToByKey[key] = "ShownForKey";
console.log(names(storedToByKey(), "storedToByKey", "ShownForKey"));

function assignedTo() { return new Error("x").stack; }
Object.assign(assignedTo, { displayName: "ShownForAssign" });
console.log(names(assignedTo(), "assignedTo", "ShownForAssign"));

function reflectedOn() { return new Error("x").stack; }
Reflect.set(reflectedOn, "displayName", "ShownForReflect");
console.log(names(reflectedOn(), "reflectedOn", "ShownForReflect"));

function inheritedFrom() { return new Error("x").stack; }
const heir = Object.create(inheritedFrom);
heir.displayName = "OnlyOnTheHeir";
console.log(names(inheritedFrom(), "inheritedFrom", "OnlyOnTheHeir"));

function outerCaller() { return innerCallee(); }
function innerCallee() { return new Error("x").stack; }
outerCaller.displayName = "ShownOuter";
innerCallee.displayName = "ShownInner";
console.log(names(outerCaller(), "outerCaller", "innerCallee", "ShownOuter", "ShownInner"));

async function awaiting() { const before = new Error("x").stack; await null; return before + new Error("x").stack; }
awaiting.displayName = "HiddenForAsync";
console.log(names(await awaiting(), "awaiting", "HiddenForAsync"));

async function renamedAwaiting() { const before = new Error("x").stack; await null; return before + new Error("x").stack; }
Object.defineProperty(renamedAwaiting, "name", { value: "HiddenNameForAsync" });
console.log(names(await renamedAwaiting(), "renamedAwaiting", "HiddenNameForAsync"));

function* yielding() { yield new Error("x").stack; }
yielding.displayName = "HiddenForGenerator";
console.log(names(yielding().next().value, "yielding", "HiddenForGenerator"));

function* renamedYielding() { yield new Error("x").stack; }
Object.defineProperty(renamedYielding, "name", { value: "HiddenNameForGenerator" });
console.log(names(renamedYielding().next().value, "renamedYielding", "HiddenNameForGenerator"));

function untouched() { return new Error("x").stack; }
console.log(names(untouched(), "untouched"), storedTo.name, storedTo.displayName, Object.keys(storedTo).join());
