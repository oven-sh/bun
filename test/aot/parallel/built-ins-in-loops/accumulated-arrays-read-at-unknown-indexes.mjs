// An accumulator that comes round as it entered and whose elements are read at unknown indexes is one array, not one array an iteration.
// STATISTIC: FreshObjectsMergedAtJoins <= 1
const numbers = Array.from({ length: 50 }, (_, i) => (i * 37) % 101);
function partition(list) {
    return list.reduce((parts, x) => {
        parts[x & 1].push(x);
        return parts;
    }, [[], []]);
}
let total = 0;
for (let turn = 0; turn < 20; turn++) {
    const [even, odd] = partition(numbers);
    total += even.length * 100 + odd[turn];
}
console.log(total, partition(numbers).map(part => part.join()).join(" | "));
