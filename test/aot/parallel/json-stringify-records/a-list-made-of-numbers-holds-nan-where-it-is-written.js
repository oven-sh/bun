const numbers = [1, 2.5, NaN, Infinity, -Infinity, -0, 0 / 0, 1e21, 2147483648];
const writeList = list => JSON.stringify(list);
const writeHolder = holder => JSON.stringify(holder);
function atTheRoot(n) { return JSON.stringify([n]); }
function atTheRootAmongOthers(n) { return JSON.stringify([0.5, n, 3]); }
function atTheRootTwice(n) { return JSON.stringify([n, n]); }
function throughAFunction(n) { return writeList([n]); }
function inAList(n) { return JSON.stringify([[n]]); }
function inAListByAName(n) { const inner = [n]; return JSON.stringify([inner]); }
function inAListBesideOthers(n) { return JSON.stringify([[1.5], [n], [n, 2.5]]); }
function inTwoLists(n) { return JSON.stringify([[[n]]]); }
function inAField(n) { return JSON.stringify({ list: [n] }); }
function inAFieldBetweenFields(n) { return JSON.stringify({ id: 1, list: [n], tail: "t" }); }
function inAFieldThroughAFunction(n) { return writeHolder({ id: 1, list: [0.5, n], tail: "t" }); }
function inAFieldOfAField(n) { return JSON.stringify({ outer: { list: [n] }, after: n }); }
function inAListInAField(n) { return JSON.stringify({ lists: [[n], [n + 1]] }); }
function inAFieldInAList(n) { return JSON.stringify([{ list: [n] }, { list: [n * 2] }]); }
function storedLater(n) { const list = [1.5]; list[0] = n; return JSON.stringify(list); }
function pushedLater(n) { const list = [1.5]; list.push(n); return JSON.stringify(list); }
function computed(n) { return JSON.stringify([n - n, n / n, n * 0]); }
function asTheNumberItself(n) { return JSON.stringify(n) + JSON.stringify({ n }) + JSON.stringify([n][0]); }
const forms = [atTheRoot, atTheRootAmongOthers, atTheRootTwice, throughAFunction, inAList, inAListByAName, inAListBesideOthers, inTwoLists, inAField, inAFieldBetweenFields, inAFieldThroughAFunction, inAFieldOfAField, inAListInAField, inAFieldInAList, storedLater, pushedLater, computed, asTheNumberItself];
for (const form of forms) console.log(form.name, numbers.map(n => form(n)).join(" "));
function inALoop(values) {
  let text = "";
  for (let i = 0; i < values.length; i++) text += JSON.stringify([values[i]]) + JSON.stringify([[values[i]]]) + JSON.stringify({ id: i, list: [values[i]] }) + " ";
  return text;
}
console.log(inALoop(numbers));
