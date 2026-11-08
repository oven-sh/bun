type Callback = (x: number) => number;

const kept: Callback[] = [];
let keeps = false;

function sum(list: number[], run: number): number {
    let total = run;
    list.forEach(x => { total += x; return total; });
    return total;
}

const proxied: number[] = new Proxy([1, 2, 3, 4], {
    get(target, key, receiver) {
        if (keeps && key === "forEach")
            return function (callback: Callback) { kept.push(callback); };
        return Reflect.get(target, key, receiver);
    },
});

let checksum = 0;
for (let run = 0; run < 1000; run++) {
    keeps = run === 500;
    checksum = (checksum * 31 + sum(proxied, run)) % 1000003;
}

console.log(checksum, kept.length);
console.log(kept[0](1), kept[0](10), kept[0](100));
console.log(sum(proxied, 7), kept[0](0), sum([5, 6], 8), kept[0](0));
