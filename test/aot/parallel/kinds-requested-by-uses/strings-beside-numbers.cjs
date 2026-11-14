// STATISTIC: StringsChosenByNames >= 1
// Elements are proven to be strings or numbers. The loop reads lengths, so it speculates strings.
function total(values) { let sum = 0; for (let i = 0; i < values.length; i++) sum += values[i].length; return sum; }
const values = []; for (let i = 0; i < 24; i++) values.push("row" + i);
console.log(total([1, 2.5, -0]), total(values), total(["ab", 3, "c"]), total([]), total([true, "xyz"]));
try { total(["a", undefined, 1]); } catch (error) { console.log(error.constructor.name); }
function codes(list) { let sum = 0; for (const value of list) sum += value.charCodeAt(0); return sum; }
console.log(codes(["a", "bc"])); try { codes(["a", 5]); } catch (error) { console.log(error.constructor.name); }
values[7] = 12; console.log(total(values));
