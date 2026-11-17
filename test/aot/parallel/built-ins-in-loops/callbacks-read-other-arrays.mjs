// The callback reads the elements of another array in each call: the chain is not fused, and the method is copied with it.
// STATISTIC: CallbackChainsFused = 0
const a = [1.5, 2, 3, 4.5], b = [2, 1, 0.5, 3], marks = [true, false, true, true], steps = [5, 1, 9, 4];
const dot = (x, y) => x.reduce((sum, value, index) => sum + value * y[index], 0);
const kept = list => list.filter((_, index) => marks[index]);
const changes = list => list.slice(1).map((value, index) => value - list[index]);
function repeat(turns) {
    let total = 0;
    for (let turn = 0; turn < turns; turn++) {
        total += dot(a, b) + kept(steps).length;
        total += changes(steps)[turn % 3];
    }
    return total;
}
console.log(repeat(12), dot([1, 2, 3], [4, 5]), String(dot([0.5, , 1.5], [1, 2, 3])), dot([1.5, 2.5], { 0: 1, 1: 2 }));
