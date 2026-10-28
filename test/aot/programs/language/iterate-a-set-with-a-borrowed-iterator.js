// Built-in objects carry an own Symbol.iterator borrowed from another built-in class, and are iterated beside plain collections.
function addFirstTwoOfSets(items) {
  const [first, second] = items;
  return first + second;
}
const textLikeSet = new Set([1, 2]);
textLikeSet[Symbol.iterator] = String.prototype[Symbol.iterator];
console.log(addFirstTwoOfSets(textLikeSet), addFirstTwoOfSets(new Set([3, 4])));

function addAllOfSets(items) {
  let total = 0;
  for (const item of items) total += item;
  return total;
}
const listLikeSet = Object.assign(new Set([1, 2]), { length: 2, 0: "x", 1: "y", [Symbol.iterator]: Array.prototype[Symbol.iterator] });
console.log(addAllOfSets(listLikeSet), addAllOfSets(new Set([3, 4])));

function addFirstTwoOfMaps(items) {
  const [first, second] = items;
  return first + "|" + second;
}
const textLikeMap = new Map([[1, 2]]);
textLikeMap[Symbol.iterator] = String.prototype[Symbol.iterator];
console.log(addFirstTwoOfMaps(textLikeMap), addFirstTwoOfMaps(new Map([[3, 4], [5, 6]])));

function addAllOfBytes(items) {
  let total = 0;
  for (const item of items) total += item;
  return total;
}
const textLikeBytes = new Uint8Array([7, 8]);
textLikeBytes[Symbol.iterator] = String.prototype[Symbol.iterator];
console.log(addAllOfBytes(textLikeBytes), addAllOfBytes(new Uint8Array([5, 6])));

function addAllOfTexts(items) {
  let total = 0;
  for (const item of items) total += item;
  return total;
}
const listLikeText = Object.assign(new String("pq"), { [Symbol.iterator]: Array.prototype[Symbol.iterator] });
const setLikeText = Object.assign(new String("rs"), { [Symbol.iterator]: Set.prototype[Symbol.iterator] });
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(addAllOfTexts(listLikeText), attempt(() => addAllOfTexts(setLikeText)), addAllOfTexts(new Set([1, 2])));

function addFirstTwoOfWrappers(items) {
  const [first, second] = items;
  return first + second;
}
const textLikeNumber = Object.assign(new Number(57), { [Symbol.iterator]: String.prototype[Symbol.iterator] });
const textLikeFlag = Object.assign(new Boolean(true), { [Symbol.iterator]: String.prototype[Symbol.iterator] });
console.log(addFirstTwoOfWrappers(textLikeNumber), addFirstTwoOfWrappers(textLikeFlag), addFirstTwoOfWrappers(new Set([1, 2])));

function addAllOfOthers(items) {
  let total = 0;
  for (const item of items) total += item;
  return total;
}
const textLikeDate = Object.assign(new Date(0), { toString() { return "date"; }, [Symbol.iterator]: String.prototype[Symbol.iterator] });
const textLikePattern = Object.assign(/x/g, { [Symbol.iterator]: String.prototype[Symbol.iterator] });
console.log(addAllOfOthers(textLikeDate), addAllOfOthers(textLikePattern), addAllOfOthers(new Set([1, 2])), addAllOfOthers(new Map().set(1, 2).keys()));
