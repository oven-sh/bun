// What is called is one built-in function or nothing yet: one test stands in front of the call, and behind it the call goes by the rows of the built-in.
function early() { try { return objectIs(1, 1); } catch (error) { return error.name + ": " + error.message; } }
console.log(early());
function ours(x, y) { return (x === y && (x !== 0 || 1 / x === 1 / y)) || (x !== x && y !== y); }
var objectIs = typeof Object.is === "function" ? Object.is : ours;
function same(a, b) { for (let i = 0; i < a.length; i++) { if (!objectIs(a[i], b[i])) return false; } return true; }
const o = {};
console.log(early(), same([1, "a", o, NaN, 0], [1, "a", o, NaN, 0]), same([0], [-0]), same(["ab"], ["a" + String.fromCharCode(98)]), same([10n], [10n]), same([o], [{}]), same([1], [1.5]), same([undefined], [null]));
console.log(objectIs(), objectIs(undefined), objectIs(1), objectIs(NaN, NaN, 3));
