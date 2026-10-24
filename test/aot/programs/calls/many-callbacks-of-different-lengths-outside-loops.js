// Array methods of the library are called outside loops with many different callbacks: some take the element alone, some the index too, some all three arguments, one reads `arguments`, one reads `this`.
// Each callback gets what the method passes, whichever copy of the method the call goes to.
const numbers = [1, 2, 3, 4];
const box = { bonus: 10 };

function mapped() {
    return [
        numbers.map(x => x + 1),
        numbers.map(x => x * 2),
        numbers.map(x => x - 3),
        numbers.map(x => x / 2),
        numbers.map(x => -x),
        numbers.map(x => x % 2),
        numbers.map((x, i) => x + i),
        numbers.map((x, i) => x * i),
        numbers.map((x, i, all) => x + i + all.length),
        numbers.map(function () { return arguments.length; }),
        numbers.map(function (x) { return x + this.bonus; }, box),
        numbers.map(() => 7),
    ];
}

function filtered() {
    return [
        numbers.filter(x => x > 1),
        numbers.filter(x => x > 2),
        numbers.filter(x => x < 3),
        numbers.filter(x => x % 2 === 0),
        numbers.filter(x => x !== 3),
        numbers.filter((x, i) => i > 0),
        numbers.filter((x, i, all) => i < all.length - 1),
        numbers.filter(function (x) { return x < this.bonus; }, box),
    ];
}

function flattened() {
    return [
        numbers.flatMap(x => [x]),
        numbers.flatMap(x => [x, x]),
        numbers.flatMap(x => x),
        numbers.flatMap(x => []),
        numbers.flatMap(x => [[x]]),
        numbers.flatMap((x, i) => [x, i]),
        numbers.flatMap((x, i, all) => [all.length]),
    ];
}

function reduced() {
    return [
        numbers.reduce((sum, x) => sum + x, 0),
        numbers.reduce((sum, x) => sum * x, 1),
        numbers.reduce((sum, x) => sum - x, 0),
        numbers.reduce((sum, x) => Math.max(sum, x), 0),
        numbers.reduce((sum, x) => Math.min(sum, x), 9),
        numbers.reduce((sum, x, i) => sum + x * i, 0),
        numbers.reduce((sum, x, i, all) => sum + all.length, 0),
        numbers.reduce(sum => sum + 1, 0),
    ];
}

function asked() {
    return [
        numbers.some(x => x > 3), numbers.some(x => x > 4), numbers.some(x => x < 0), numbers.some(x => x === 2), numbers.some(x => x === 9), numbers.some((x, i) => i === 3),
        numbers.every(x => x > 0), numbers.every(x => x > 1), numbers.every(x => x < 5), numbers.every(x => x !== 3), numbers.every(x => x === x), numbers.every((x, i) => i < 4),
        numbers.find(x => x > 1), numbers.find(x => x > 2), numbers.find(x => x > 3), numbers.find(x => x > 4), numbers.find(x => x < 2), numbers.find((x, i) => i === 2),
    ];
}

console.log(JSON.stringify(mapped()));
console.log(JSON.stringify(filtered()));
console.log(JSON.stringify(flattened()));
console.log(JSON.stringify(reduced()));
console.log(JSON.stringify(asked()));
