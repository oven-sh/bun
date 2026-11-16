// STATISTIC: RecordsChosenByNames >= 1
// Elements are proven to be records or arrays. The loop reads a name that arrays lack, so it speculates the record.
function total(values) { let sum = 0; for (let i = 0; i < values.length; i++) sum += values[i].first * values[i].second; return sum; }
const values = []; for (let i = 0; i < 24; i++) values.push({ first: i, second: i + 1 });
console.log(total([[1, 2], [3]]), total(values), total([{ first: 2, second: 3 }, [1]]), total([]));
try { total([{ first: 1, second: 2 }, undefined]); } catch (error) { console.log(error.constructor.name); }
const odd = [1, 2]; odd.first = 5; odd.second = { valueOf() { console.log("converted"); return 7; } };
console.log(total([odd, { first: 1, second: 1 }]), total(values));
