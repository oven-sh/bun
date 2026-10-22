const launder = new Function("v", "return v") as <V>(v: V) => V;

const keys: number[] = launder([0, 1, 2, 3, 4, 5, -0, -1, 0.5, 1.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, 4294967294, 4294967295, 4294967296, 9007199254740991, 9223372036854775807, -9223372036854775808, 1e300, -1e300, 5e-324]);

function read(list: number[], key: number): number { return list[key]; }
function readTwice(list: number[], key: number): number { return list[list[key]]; }
function readNext(list: number[], key: number): number { return list[key + 1]; }
function has(list: number[], key: number): boolean { return key in list; }
function store(list: number[], key: number, value: number): void { list[key] = value; }
function storeAndRead(list: number[], key: number): number { list[key] = key; return list[key + 1]; }
function readText(list: string[], key: number): string { return list[key]; }
function storeText(list: string[], key: number, value: string): void { list[key] = value; }
function readAny(list: unknown[], key: number): unknown { return list[key]; }
function readBytes(list: Uint8Array, key: number): number { return list[key]; }

function describe(list: readonly unknown[]): string {
    return JSON.stringify(Object.entries(list).map(([key, value]) => key + "=" + String(value))) + " " + list.length;
}

function makeDoubles(): number[] { return launder([0.5, 1, 2, 3.25, 4]); }
function makeIntegers(): number[] { return launder([1, 2, 3, 4, 0]); }
function makeWithHole(): number[] { const list = [1.5, 2, 3, 4, 5]; delete list[2]; return launder(list); }
function makeWithNaN(): number[] { return launder([NaN, 1, NaN, 3, 2.5]); }
function makeWithNamedNaN(): number[] {
    const list = [4, 3, 2.5, 1, 0];
    (list as unknown as Record<string, number>)["NaN"] = 77;
    (list as unknown as Record<string, number>)["-1"] = 78;
    (list as unknown as Record<string, number>)["0.5"] = 79;
    (list as unknown as Record<string, number>)["Infinity"] = 80;
    return launder(list);
}

const makers = [makeDoubles, makeIntegers, makeWithHole, makeWithNaN, makeWithNamedNaN];
for (const make of makers) {
    for (const key of keys) {
        const list = make();
        console.log(make.name, key, Object.is(key, -0), read(list, key), readTwice(list, key), readNext(list, key), has(list, key), readAny(list, key));
    }
    for (const key of keys) {
        if (key > 100 && key < 4294967295)
            continue;
        const list = make();
        store(list, key, 9.5);
        console.log(make.name, "store", key, describe(list));
        const other = make();
        console.log(make.name, "both", key, storeAndRead(other, key), describe(other));
        const third = make();
        store(third, key, NaN);
        console.log(make.name, "NaN", key, describe(third), read(third, key));
    }
}

for (const key of keys) {
    const texts = launder(["a", "b", "c"]);
    (texts as unknown as Record<string, string>)["NaN"] = "named";
    console.log("texts", key, readText(texts, key));
    if (key > 100 && key < 4294967295)
        continue;
    storeText(texts, key, "z");
    console.log("texts", key, describe(texts));
    console.log("bytes", key, readBytes(launder(new Uint8Array([7, 8, 9])), key));
}

let sum = 0;
const chain = launder([1, 2, 3, 4, 5, 6, 7, NaN, 0.5]);
for (let round = 0; round < 20000; ++round) {
    let key = round % 9;
    for (let step = 0; step < 4 && key === key && key !== undefined; ++step)
        key = read(chain, key);
    sum += key === key && key !== undefined ? key : 100;
}
console.log(sum);
