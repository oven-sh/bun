// In-place array methods on dense arrays. Every array has its own reader, so a wrong proof about one array is not hidden by another.

function position() { return 3; }
const reversedStrings = ["a", "b", "c", "d"];
function change_reversedStrings() { const L = reversedStrings; L.reverse(); }
function read_reversedStrings() { let text = ""; for (let i = 0; i < reversedStrings.length; i++) text += String(reversedStrings[i]) + (i in reversedStrings ? "," : "!"); return text + reversedStrings.length; }
const sortedStrings = ["a", "b", "c", "d"];
function change_sortedStrings() { const L = sortedStrings; L.sort((a, b) => (a < b ? 1 : -1)); }
function read_sortedStrings() { let text = ""; for (let i = 0; i < sortedStrings.length; i++) text += String(sortedStrings[i]) + (i in sortedStrings ? "," : "!"); return text + sortedStrings.length; }
const sortedByDefaultStrings = ["a", "b", "c", "d"];
function change_sortedByDefaultStrings() { const L = sortedByDefaultStrings; L.sort(); }
function read_sortedByDefaultStrings() { let text = ""; for (let i = 0; i < sortedByDefaultStrings.length; i++) text += String(sortedByDefaultStrings[i]) + (i in sortedByDefaultStrings ? "," : "!"); return text + sortedByDefaultStrings.length; }
const copiedWithinStrings = ["a", "b", "c", "d"];
function change_copiedWithinStrings() { const L = copiedWithinStrings; L.copyWithin(0, 2); }
function read_copiedWithinStrings() { let text = ""; for (let i = 0; i < copiedWithinStrings.length; i++) text += String(copiedWithinStrings[i]) + (i in copiedWithinStrings ? "," : "!"); return text + copiedWithinStrings.length; }
const filledStrings = ["a", "b", "c", "d"];
function change_filledStrings() { const L = filledStrings; L.fill("x", 1, 3); }
function read_filledStrings() { let text = ""; for (let i = 0; i < filledStrings.length; i++) text += String(filledStrings[i]) + (i in filledStrings ? "," : "!"); return text + filledStrings.length; }
const splicedStrings = ["a", "b", "c", "d"];
function change_splicedStrings() { const L = splicedStrings; L.splice(1, 2, "x", "x", "x"); }
function read_splicedStrings() { let text = ""; for (let i = 0; i < splicedStrings.length; i++) text += String(splicedStrings[i]) + (i in splicedStrings ? "," : "!"); return text + splicedStrings.length; }
const clearedStrings = ["a", "b", "c", "d"];
function change_clearedStrings() { const L = clearedStrings; L.length = 0; L.push("x", "x"); }
function read_clearedStrings() { let text = ""; for (let i = 0; i < clearedStrings.length; i++) text += String(clearedStrings[i]) + (i in clearedStrings ? "," : "!"); return text + clearedStrings.length; }
const fillShrinksStrings = ["a", "b", "c", "d"];
function change_fillShrinksStrings() { const L = fillShrinksStrings; L.fill("x", { valueOf() { L.length = 0; return 2; } }); }
function read_fillShrinksStrings() { let text = ""; for (let i = 0; i < fillShrinksStrings.length; i++) text += String(fillShrinksStrings[i]) + (i in fillShrinksStrings ? "," : "!"); return text + fillShrinksStrings.length; }
const fillEndShrinksStrings = ["a", "b", "c", "d"];
function change_fillEndShrinksStrings() { const L = fillEndShrinksStrings; L.fill("x", 3, { valueOf() { L.pop(); L.pop(); L.pop(); return 4; } }); }
function read_fillEndShrinksStrings() { let text = ""; for (let i = 0; i < fillEndShrinksStrings.length; i++) text += String(fillEndShrinksStrings[i]) + (i in fillEndShrinksStrings ? "," : "!"); return text + fillEndShrinksStrings.length; }
const spliceStartShrinksStrings = ["a", "b", "c", "d"];
function change_spliceStartShrinksStrings() { const L = spliceStartShrinksStrings; L.splice({ valueOf() { L.length = 1; return 0; } }, 1); }
function read_spliceStartShrinksStrings() { let text = ""; for (let i = 0; i < spliceStartShrinksStrings.length; i++) text += String(spliceStartShrinksStrings[i]) + (i in spliceStartShrinksStrings ? "," : "!"); return text + spliceStartShrinksStrings.length; }
const spliceCountShrinksStrings = ["a", "b", "c", "d"];
function change_spliceCountShrinksStrings() { const L = spliceCountShrinksStrings; L.splice(0, { valueOf() { L.length = 0; return 1; } }); }
function read_spliceCountShrinksStrings() { let text = ""; for (let i = 0; i < spliceCountShrinksStrings.length; i++) text += String(spliceCountShrinksStrings[i]) + (i in spliceCountShrinksStrings ? "," : "!"); return text + spliceCountShrinksStrings.length; }
const spliceSpreadShrinksStrings = ["a", "b", "c", "d"];
function change_spliceSpreadShrinksStrings() { const L = spliceSpreadShrinksStrings; L.splice(...[{ valueOf() { L.length = 1; return 0; } }, 1]); }
function read_spliceSpreadShrinksStrings() { let text = ""; for (let i = 0; i < spliceSpreadShrinksStrings.length; i++) text += String(spliceSpreadShrinksStrings[i]) + (i in spliceSpreadShrinksStrings ? "," : "!"); return text + spliceSpreadShrinksStrings.length; }
const copyWithinShrinksStrings = ["a", "b", "c", "d"];
function change_copyWithinShrinksStrings() { const L = copyWithinShrinksStrings; L.copyWithin(0, { valueOf() { L.length = 2; return 1; } }); }
function read_copyWithinShrinksStrings() { let text = ""; for (let i = 0; i < copyWithinShrinksStrings.length; i++) text += String(copyWithinShrinksStrings[i]) + (i in copyWithinShrinksStrings ? "," : "!"); return text + copyWithinShrinksStrings.length; }
const fillCalledShrinksStrings = ["a", "b", "c", "d"];
function change_fillCalledShrinksStrings() { const L = fillCalledShrinksStrings; Array.prototype.fill.call(L, "x", { valueOf() { L.length = 0; return 2; } }); }
function read_fillCalledShrinksStrings() { let text = ""; for (let i = 0; i < fillCalledShrinksStrings.length; i++) text += String(fillCalledShrinksStrings[i]) + (i in fillCalledShrinksStrings ? "," : "!"); return text + fillCalledShrinksStrings.length; }
const fillAppliedShrinksStrings = ["a", "b", "c", "d"];
function change_fillAppliedShrinksStrings() { const L = fillAppliedShrinksStrings; Array.prototype.fill.apply(L, ["x", { valueOf() { L.length = 0; return 2; } }]); }
function read_fillAppliedShrinksStrings() { let text = ""; for (let i = 0; i < fillAppliedShrinksStrings.length; i++) text += String(fillAppliedShrinksStrings[i]) + (i in fillAppliedShrinksStrings ? "," : "!"); return text + fillAppliedShrinksStrings.length; }
const spliceSpeciesShrinksStrings = ["a", "b", "c", "d"];
function change_spliceSpeciesShrinksStrings() { const L = spliceSpeciesShrinksStrings; L.constructor = { [Symbol.species]: function () { L.length = 0; return []; } }; L.splice(1, 1); }
function read_spliceSpeciesShrinksStrings() { let text = ""; for (let i = 0; i < spliceSpeciesShrinksStrings.length; i++) text += String(spliceSpeciesShrinksStrings[i]) + (i in spliceSpeciesShrinksStrings ? "," : "!"); return text + spliceSpeciesShrinksStrings.length; }
const comparatorPopsStrings = ["a", "b", "c", "d"];
function change_comparatorPopsStrings() { const L = comparatorPopsStrings; L.sort((a, b) => { if (L.length > 1) L.pop(); return a < b ? 1 : -1; }); }
function read_comparatorPopsStrings() { let text = ""; for (let i = 0; i < comparatorPopsStrings.length; i++) text += String(comparatorPopsStrings[i]) + (i in comparatorPopsStrings ? "," : "!"); return text + comparatorPopsStrings.length; }
const comparatorClearsStrings = ["a", "b", "c", "d"];
function change_comparatorClearsStrings() { const L = comparatorClearsStrings; L.sort((a, b) => { L.length = 0; return a < b ? 1 : -1; }); }
function read_comparatorClearsStrings() { let text = ""; for (let i = 0; i < comparatorClearsStrings.length; i++) text += String(comparatorClearsStrings[i]) + (i in comparatorClearsStrings ? "," : "!"); return text + comparatorClearsStrings.length; }
const comparatorPushesStrings = ["a", "b", "c", "d"];
function change_comparatorPushesStrings() { const L = comparatorPushesStrings; let pushed = false; L.sort((a, b) => { if (!pushed) { pushed = true; L.push("x"); } return a < b ? 1 : -1; }); }
function read_comparatorPushesStrings() { let text = ""; for (let i = 0; i < comparatorPushesStrings.length; i++) text += String(comparatorPushesStrings[i]) + (i in comparatorPushesStrings ? "," : "!"); return text + comparatorPushesStrings.length; }
const clearedBeforeInBoundsStoreStrings = ["a", "b", "c", "d"];
function change_clearedBeforeInBoundsStoreStrings() { const L = clearedBeforeInBoundsStoreStrings; const i = position() >>> 0; if (i < L.length) { L.length = 0; L[i] = "x"; } }
function read_clearedBeforeInBoundsStoreStrings() { let text = ""; for (let i = 0; i < clearedBeforeInBoundsStoreStrings.length; i++) text += String(clearedBeforeInBoundsStoreStrings[i]) + (i in clearedBeforeInBoundsStoreStrings ? "," : "!"); return text + clearedBeforeInBoundsStoreStrings.length; }
const splicedBeforeInBoundsStoreStrings = ["a", "b", "c", "d"];
function change_splicedBeforeInBoundsStoreStrings() { const L = splicedBeforeInBoundsStoreStrings; const i = position() >>> 0; if (i < L.length) { L.splice(0, 3); L[i] = "x"; } }
function read_splicedBeforeInBoundsStoreStrings() { let text = ""; for (let i = 0; i < splicedBeforeInBoundsStoreStrings.length; i++) text += String(splicedBeforeInBoundsStoreStrings[i]) + (i in splicedBeforeInBoundsStoreStrings ? "," : "!"); return text + splicedBeforeInBoundsStoreStrings.length; }
const lengthFromStringStrings = ["a", "b", "c", "d"];
function change_lengthFromStringStrings() { const L = lengthFromStringStrings; L.length = "6"; }
function read_lengthFromStringStrings() { let text = ""; for (let i = 0; i < lengthFromStringStrings.length; i++) text += String(lengthFromStringStrings[i]) + (i in lengthFromStringStrings ? "," : "!"); return text + lengthFromStringStrings.length; }
const lengthRaisedStrings = ["a", "b", "c", "d"];
function change_lengthRaisedStrings() { const L = lengthRaisedStrings; L.length = L.length + 2; }
function read_lengthRaisedStrings() { let text = ""; for (let i = 0; i < lengthRaisedStrings.length; i++) text += String(lengthRaisedStrings[i]) + (i in lengthRaisedStrings ? "," : "!"); return text + lengthRaisedStrings.length; }
const reversedNumbers = [1, 2, 3, 4];
function change_reversedNumbers() { const L = reversedNumbers; L.reverse(); }
function read_reversedNumbers() { let text = ""; for (let i = 0; i < reversedNumbers.length; i++) text += String(reversedNumbers[i]) + (i in reversedNumbers ? "," : "!"); return text + reversedNumbers.length; }
const sortedNumbers = [1, 2, 3, 4];
function change_sortedNumbers() { const L = sortedNumbers; L.sort((a, b) => (a < b ? 1 : -1)); }
function read_sortedNumbers() { let text = ""; for (let i = 0; i < sortedNumbers.length; i++) text += String(sortedNumbers[i]) + (i in sortedNumbers ? "," : "!"); return text + sortedNumbers.length; }
const sortedByDefaultNumbers = [1, 2, 3, 4];
function change_sortedByDefaultNumbers() { const L = sortedByDefaultNumbers; L.sort(); }
function read_sortedByDefaultNumbers() { let text = ""; for (let i = 0; i < sortedByDefaultNumbers.length; i++) text += String(sortedByDefaultNumbers[i]) + (i in sortedByDefaultNumbers ? "," : "!"); return text + sortedByDefaultNumbers.length; }
const copiedWithinNumbers = [1, 2, 3, 4];
function change_copiedWithinNumbers() { const L = copiedWithinNumbers; L.copyWithin(0, 2); }
function read_copiedWithinNumbers() { let text = ""; for (let i = 0; i < copiedWithinNumbers.length; i++) text += String(copiedWithinNumbers[i]) + (i in copiedWithinNumbers ? "," : "!"); return text + copiedWithinNumbers.length; }
const filledNumbers = [1, 2, 3, 4];
function change_filledNumbers() { const L = filledNumbers; L.fill(9, 1, 3); }
function read_filledNumbers() { let text = ""; for (let i = 0; i < filledNumbers.length; i++) text += String(filledNumbers[i]) + (i in filledNumbers ? "," : "!"); return text + filledNumbers.length; }
const splicedNumbers = [1, 2, 3, 4];
function change_splicedNumbers() { const L = splicedNumbers; L.splice(1, 2, 9, 9, 9); }
function read_splicedNumbers() { let text = ""; for (let i = 0; i < splicedNumbers.length; i++) text += String(splicedNumbers[i]) + (i in splicedNumbers ? "," : "!"); return text + splicedNumbers.length; }
const clearedNumbers = [1, 2, 3, 4];
function change_clearedNumbers() { const L = clearedNumbers; L.length = 0; L.push(9, 9); }
function read_clearedNumbers() { let text = ""; for (let i = 0; i < clearedNumbers.length; i++) text += String(clearedNumbers[i]) + (i in clearedNumbers ? "," : "!"); return text + clearedNumbers.length; }
const fillShrinksNumbers = [1, 2, 3, 4];
function change_fillShrinksNumbers() { const L = fillShrinksNumbers; L.fill(9, { valueOf() { L.length = 0; return 2; } }); }
function read_fillShrinksNumbers() { let text = ""; for (let i = 0; i < fillShrinksNumbers.length; i++) text += String(fillShrinksNumbers[i]) + (i in fillShrinksNumbers ? "," : "!"); return text + fillShrinksNumbers.length; }
const fillEndShrinksNumbers = [1, 2, 3, 4];
function change_fillEndShrinksNumbers() { const L = fillEndShrinksNumbers; L.fill(9, 3, { valueOf() { L.pop(); L.pop(); L.pop(); return 4; } }); }
function read_fillEndShrinksNumbers() { let text = ""; for (let i = 0; i < fillEndShrinksNumbers.length; i++) text += String(fillEndShrinksNumbers[i]) + (i in fillEndShrinksNumbers ? "," : "!"); return text + fillEndShrinksNumbers.length; }
const spliceStartShrinksNumbers = [1, 2, 3, 4];
function change_spliceStartShrinksNumbers() { const L = spliceStartShrinksNumbers; L.splice({ valueOf() { L.length = 1; return 0; } }, 1); }
function read_spliceStartShrinksNumbers() { let text = ""; for (let i = 0; i < spliceStartShrinksNumbers.length; i++) text += String(spliceStartShrinksNumbers[i]) + (i in spliceStartShrinksNumbers ? "," : "!"); return text + spliceStartShrinksNumbers.length; }
const spliceCountShrinksNumbers = [1, 2, 3, 4];
function change_spliceCountShrinksNumbers() { const L = spliceCountShrinksNumbers; L.splice(0, { valueOf() { L.length = 0; return 1; } }); }
function read_spliceCountShrinksNumbers() { let text = ""; for (let i = 0; i < spliceCountShrinksNumbers.length; i++) text += String(spliceCountShrinksNumbers[i]) + (i in spliceCountShrinksNumbers ? "," : "!"); return text + spliceCountShrinksNumbers.length; }
const spliceSpreadShrinksNumbers = [1, 2, 3, 4];
function change_spliceSpreadShrinksNumbers() { const L = spliceSpreadShrinksNumbers; L.splice(...[{ valueOf() { L.length = 1; return 0; } }, 1]); }
function read_spliceSpreadShrinksNumbers() { let text = ""; for (let i = 0; i < spliceSpreadShrinksNumbers.length; i++) text += String(spliceSpreadShrinksNumbers[i]) + (i in spliceSpreadShrinksNumbers ? "," : "!"); return text + spliceSpreadShrinksNumbers.length; }
const copyWithinShrinksNumbers = [1, 2, 3, 4];
function change_copyWithinShrinksNumbers() { const L = copyWithinShrinksNumbers; L.copyWithin(0, { valueOf() { L.length = 2; return 1; } }); }
function read_copyWithinShrinksNumbers() { let text = ""; for (let i = 0; i < copyWithinShrinksNumbers.length; i++) text += String(copyWithinShrinksNumbers[i]) + (i in copyWithinShrinksNumbers ? "," : "!"); return text + copyWithinShrinksNumbers.length; }
const fillCalledShrinksNumbers = [1, 2, 3, 4];
function change_fillCalledShrinksNumbers() { const L = fillCalledShrinksNumbers; Array.prototype.fill.call(L, 9, { valueOf() { L.length = 0; return 2; } }); }
function read_fillCalledShrinksNumbers() { let text = ""; for (let i = 0; i < fillCalledShrinksNumbers.length; i++) text += String(fillCalledShrinksNumbers[i]) + (i in fillCalledShrinksNumbers ? "," : "!"); return text + fillCalledShrinksNumbers.length; }
const fillAppliedShrinksNumbers = [1, 2, 3, 4];
function change_fillAppliedShrinksNumbers() { const L = fillAppliedShrinksNumbers; Array.prototype.fill.apply(L, [9, { valueOf() { L.length = 0; return 2; } }]); }
function read_fillAppliedShrinksNumbers() { let text = ""; for (let i = 0; i < fillAppliedShrinksNumbers.length; i++) text += String(fillAppliedShrinksNumbers[i]) + (i in fillAppliedShrinksNumbers ? "," : "!"); return text + fillAppliedShrinksNumbers.length; }
const spliceSpeciesShrinksNumbers = [1, 2, 3, 4];
function change_spliceSpeciesShrinksNumbers() { const L = spliceSpeciesShrinksNumbers; L.constructor = { [Symbol.species]: function () { L.length = 0; return []; } }; L.splice(1, 1); }
function read_spliceSpeciesShrinksNumbers() { let text = ""; for (let i = 0; i < spliceSpeciesShrinksNumbers.length; i++) text += String(spliceSpeciesShrinksNumbers[i]) + (i in spliceSpeciesShrinksNumbers ? "," : "!"); return text + spliceSpeciesShrinksNumbers.length; }
const comparatorPopsNumbers = [1, 2, 3, 4];
function change_comparatorPopsNumbers() { const L = comparatorPopsNumbers; L.sort((a, b) => { if (L.length > 1) L.pop(); return a < b ? 1 : -1; }); }
function read_comparatorPopsNumbers() { let text = ""; for (let i = 0; i < comparatorPopsNumbers.length; i++) text += String(comparatorPopsNumbers[i]) + (i in comparatorPopsNumbers ? "," : "!"); return text + comparatorPopsNumbers.length; }
const comparatorClearsNumbers = [1, 2, 3, 4];
function change_comparatorClearsNumbers() { const L = comparatorClearsNumbers; L.sort((a, b) => { L.length = 0; return a < b ? 1 : -1; }); }
function read_comparatorClearsNumbers() { let text = ""; for (let i = 0; i < comparatorClearsNumbers.length; i++) text += String(comparatorClearsNumbers[i]) + (i in comparatorClearsNumbers ? "," : "!"); return text + comparatorClearsNumbers.length; }
const comparatorPushesNumbers = [1, 2, 3, 4];
function change_comparatorPushesNumbers() { const L = comparatorPushesNumbers; let pushed = false; L.sort((a, b) => { if (!pushed) { pushed = true; L.push(9); } return a < b ? 1 : -1; }); }
function read_comparatorPushesNumbers() { let text = ""; for (let i = 0; i < comparatorPushesNumbers.length; i++) text += String(comparatorPushesNumbers[i]) + (i in comparatorPushesNumbers ? "," : "!"); return text + comparatorPushesNumbers.length; }
const clearedBeforeInBoundsStoreNumbers = [1, 2, 3, 4];
function change_clearedBeforeInBoundsStoreNumbers() { const L = clearedBeforeInBoundsStoreNumbers; const i = position() >>> 0; if (i < L.length) { L.length = 0; L[i] = 9; } }
function read_clearedBeforeInBoundsStoreNumbers() { let text = ""; for (let i = 0; i < clearedBeforeInBoundsStoreNumbers.length; i++) text += String(clearedBeforeInBoundsStoreNumbers[i]) + (i in clearedBeforeInBoundsStoreNumbers ? "," : "!"); return text + clearedBeforeInBoundsStoreNumbers.length; }
const splicedBeforeInBoundsStoreNumbers = [1, 2, 3, 4];
function change_splicedBeforeInBoundsStoreNumbers() { const L = splicedBeforeInBoundsStoreNumbers; const i = position() >>> 0; if (i < L.length) { L.splice(0, 3); L[i] = 9; } }
function read_splicedBeforeInBoundsStoreNumbers() { let text = ""; for (let i = 0; i < splicedBeforeInBoundsStoreNumbers.length; i++) text += String(splicedBeforeInBoundsStoreNumbers[i]) + (i in splicedBeforeInBoundsStoreNumbers ? "," : "!"); return text + splicedBeforeInBoundsStoreNumbers.length; }
const lengthFromStringNumbers = [1, 2, 3, 4];
function change_lengthFromStringNumbers() { const L = lengthFromStringNumbers; L.length = "6"; }
function read_lengthFromStringNumbers() { let text = ""; for (let i = 0; i < lengthFromStringNumbers.length; i++) text += String(lengthFromStringNumbers[i]) + (i in lengthFromStringNumbers ? "," : "!"); return text + lengthFromStringNumbers.length; }
const lengthRaisedNumbers = [1, 2, 3, 4];
function change_lengthRaisedNumbers() { const L = lengthRaisedNumbers; L.length = L.length + 2; }
function read_lengthRaisedNumbers() { let text = ""; for (let i = 0; i < lengthRaisedNumbers.length; i++) text += String(lengthRaisedNumbers[i]) + (i in lengthRaisedNumbers ? "," : "!"); return text + lengthRaisedNumbers.length; }
const reversedWithHole = ["a", , "c"];
function change_reversedWithHole() { const L = reversedWithHole; L.reverse(); }
function read_reversedWithHole() { let text = ""; for (let i = 0; i < reversedWithHole.length; i++) text += String(reversedWithHole[i]) + (i in reversedWithHole ? "," : "!"); return text + reversedWithHole.length; }
const sortedWithHole = ["b", , "a"];
function change_sortedWithHole() { const L = sortedWithHole; L.sort(); }
function read_sortedWithHole() { let text = ""; for (let i = 0; i < sortedWithHole.length; i++) text += String(sortedWithHole[i]) + (i in sortedWithHole ? "," : "!"); return text + sortedWithHole.length; }
const partlyFilled = new Array(4);
function change_partlyFilled() { const L = partlyFilled; L.fill("x", 1, 3); }
function read_partlyFilled() { let text = ""; for (let i = 0; i < partlyFilled.length; i++) text += String(partlyFilled[i]) + (i in partlyFilled ? "," : "!"); return text + partlyFilled.length; }
const toStringPops = [0, 0, 0, 0];
function change_toStringPops() { const L = toStringPops; for (let i = 0; i < 4; i++) L[i] = { toString() { if (L.length > 1) L.pop(); return String(4 - i); } }; L.sort(); }
function read_toStringPops() { let text = ""; for (let i = 0; i < toStringPops.length; i++) text += String(toStringPops[i]) + (i in toStringPops ? "," : "!"); return text + toStringPops.length; }

const cases = [
  ["reversedStrings", change_reversedStrings, read_reversedStrings],
  ["sortedStrings", change_sortedStrings, read_sortedStrings],
  ["sortedByDefaultStrings", change_sortedByDefaultStrings, read_sortedByDefaultStrings],
  ["copiedWithinStrings", change_copiedWithinStrings, read_copiedWithinStrings],
  ["filledStrings", change_filledStrings, read_filledStrings],
  ["splicedStrings", change_splicedStrings, read_splicedStrings],
  ["clearedStrings", change_clearedStrings, read_clearedStrings],
  ["fillShrinksStrings", change_fillShrinksStrings, read_fillShrinksStrings],
  ["fillEndShrinksStrings", change_fillEndShrinksStrings, read_fillEndShrinksStrings],
  ["spliceStartShrinksStrings", change_spliceStartShrinksStrings, read_spliceStartShrinksStrings],
  ["spliceCountShrinksStrings", change_spliceCountShrinksStrings, read_spliceCountShrinksStrings],
  ["spliceSpreadShrinksStrings", change_spliceSpreadShrinksStrings, read_spliceSpreadShrinksStrings],
  ["copyWithinShrinksStrings", change_copyWithinShrinksStrings, read_copyWithinShrinksStrings],
  ["fillCalledShrinksStrings", change_fillCalledShrinksStrings, read_fillCalledShrinksStrings],
  ["fillAppliedShrinksStrings", change_fillAppliedShrinksStrings, read_fillAppliedShrinksStrings],
  ["spliceSpeciesShrinksStrings", change_spliceSpeciesShrinksStrings, read_spliceSpeciesShrinksStrings],
  ["comparatorPopsStrings", change_comparatorPopsStrings, read_comparatorPopsStrings],
  ["comparatorClearsStrings", change_comparatorClearsStrings, read_comparatorClearsStrings],
  ["comparatorPushesStrings", change_comparatorPushesStrings, read_comparatorPushesStrings],
  ["clearedBeforeInBoundsStoreStrings", change_clearedBeforeInBoundsStoreStrings, read_clearedBeforeInBoundsStoreStrings],
  ["splicedBeforeInBoundsStoreStrings", change_splicedBeforeInBoundsStoreStrings, read_splicedBeforeInBoundsStoreStrings],
  ["lengthFromStringStrings", change_lengthFromStringStrings, read_lengthFromStringStrings],
  ["lengthRaisedStrings", change_lengthRaisedStrings, read_lengthRaisedStrings],
  ["reversedNumbers", change_reversedNumbers, read_reversedNumbers],
  ["sortedNumbers", change_sortedNumbers, read_sortedNumbers],
  ["sortedByDefaultNumbers", change_sortedByDefaultNumbers, read_sortedByDefaultNumbers],
  ["copiedWithinNumbers", change_copiedWithinNumbers, read_copiedWithinNumbers],
  ["filledNumbers", change_filledNumbers, read_filledNumbers],
  ["splicedNumbers", change_splicedNumbers, read_splicedNumbers],
  ["clearedNumbers", change_clearedNumbers, read_clearedNumbers],
  ["fillShrinksNumbers", change_fillShrinksNumbers, read_fillShrinksNumbers],
  ["fillEndShrinksNumbers", change_fillEndShrinksNumbers, read_fillEndShrinksNumbers],
  ["spliceStartShrinksNumbers", change_spliceStartShrinksNumbers, read_spliceStartShrinksNumbers],
  ["spliceCountShrinksNumbers", change_spliceCountShrinksNumbers, read_spliceCountShrinksNumbers],
  ["spliceSpreadShrinksNumbers", change_spliceSpreadShrinksNumbers, read_spliceSpreadShrinksNumbers],
  ["copyWithinShrinksNumbers", change_copyWithinShrinksNumbers, read_copyWithinShrinksNumbers],
  ["fillCalledShrinksNumbers", change_fillCalledShrinksNumbers, read_fillCalledShrinksNumbers],
  ["fillAppliedShrinksNumbers", change_fillAppliedShrinksNumbers, read_fillAppliedShrinksNumbers],
  ["spliceSpeciesShrinksNumbers", change_spliceSpeciesShrinksNumbers, read_spliceSpeciesShrinksNumbers],
  ["comparatorPopsNumbers", change_comparatorPopsNumbers, read_comparatorPopsNumbers],
  ["comparatorClearsNumbers", change_comparatorClearsNumbers, read_comparatorClearsNumbers],
  ["comparatorPushesNumbers", change_comparatorPushesNumbers, read_comparatorPushesNumbers],
  ["clearedBeforeInBoundsStoreNumbers", change_clearedBeforeInBoundsStoreNumbers, read_clearedBeforeInBoundsStoreNumbers],
  ["splicedBeforeInBoundsStoreNumbers", change_splicedBeforeInBoundsStoreNumbers, read_splicedBeforeInBoundsStoreNumbers],
  ["lengthFromStringNumbers", change_lengthFromStringNumbers, read_lengthFromStringNumbers],
  ["lengthRaisedNumbers", change_lengthRaisedNumbers, read_lengthRaisedNumbers],
  ["reversedWithHole", change_reversedWithHole, read_reversedWithHole],
  ["sortedWithHole", change_sortedWithHole, read_sortedWithHole],
  ["partlyFilled", change_partlyFilled, read_partlyFilled],
  ["toStringPops", change_toStringPops, read_toStringPops],
];
for (const [name, change, read] of cases) {
  const before = read();
  change();
  let after = "";
  for (let round = 0; round < 3; round++) after = read();
  console.log(name, before, "->", after);
}
