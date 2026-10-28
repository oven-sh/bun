// `[].concat.call("1.0")` converts its receiver to an object first: the new array holds a String object, not a string. Each use has a list of its own.
const readsMissingMember = [].concat.call("1.0");
console.log(readsMissingMember[0].double);

const readsLength = [].concat.call("1.0");
console.log(readsLength[0].length);

const asksForKind = [].concat.call("1.0");
console.log(typeof asksForKind[0], asksForKind[0] instanceof String);

const compares = [].concat.call("1.0");
console.log(compares[0] === "1.0", compares[0] == "1.0", Object.is(compares[0], compares[0]));

const adds = [].concat.call("1.0");
console.log(adds[0] + "!");

const listsKeys = [].concat.call("1.0");
console.log(Object.keys(listsKeys[0]).join(), JSON.stringify(listsKeys));

const searches = [].concat.call("1.0");
console.log(searches.includes("1.0"), searches.indexOf("1.0"));

const fillsSet = [].concat.call("1.0");
console.log(new Set(fillsSet).has("1.0"), new Set(fillsSet).size);

const stores = [].concat.call("1.0");
stores[0].note = "kept";
console.log(stores[0].note);

const fallsBack = [].concat.call("");
console.log(typeof (fallsBack[0] || "empty"), fallsBack[0] ? "truthy" : "falsy");

const wrapsZero = [].concat.call(0);
console.log(typeof wrapsZero[0], wrapsZero[0] ? "truthy" : "falsy", wrapsZero[0] + 1);

const wrapsFalse = Array.prototype.concat.call(false, true);
console.log(typeof wrapsFalse[0], typeof wrapsFalse[1], wrapsFalse[0] ? "truthy" : "falsy");

const held = [];
const throughAnotherList = held.concat.call("1.0");
console.log(throughAnotherList.length, throughAnotherList[0].double);
