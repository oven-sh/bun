const pending = () => new Promise(resolve => queueMicrotask(() => resolve(1)));

async function restAsync(...rest) {
    const first = await pending();
    const second = await pending();
    return rest.length + first + second;
}
async function argumentsAsync() {
    const count = arguments.length;
    return count + (await pending()) + arguments.length;
}
const arrowAsync = async (...rest) => {
    await pending();
    return rest.reduce((sum, value) => sum + value, 0);
};
function* restGenerator(...rest) {
    for (const value of rest) yield value;
}
function* argumentsGenerator() {
    for (let i = 0; i < arguments.length; i++) yield arguments[i];
}
async function* restAsyncGenerator(...rest) {
    for (const value of rest) {
        await pending();
        yield value;
    }
}
class Holder {
    async method(...rest) {
        await pending();
        return rest.length;
    }
    static async fixed() {
        await pending();
        return arguments.length;
    }
}

const table = { restAsync, argumentsAsync, arrowAsync, restGenerator, argumentsGenerator, restAsyncGenerator, method: new Holder().method, fixed: Holder.fixed };

function callByName(name, a, b, c, d, e, f) {
    const before = [a, b, c, d, e, f].join();
    const result = table[name](a, b, c, d, e, f);
    if (before !== [a, b, c, d, e, f].join()) throw new Error("the caller's values moved: " + name);
    return result;
}

function below(depth, name) {
    const x = depth * 3;
    const y = depth + 7;
    const result = depth ? below(depth - 1, name) : callByName(name, 1, 2, 3, 4, 5, 6);
    if (x !== depth * 3 || y !== depth + 7) throw new Error("a caller's value moved: " + name);
    return result;
}

async function total(value) {
    if (value[Symbol.asyncIterator]) {
        let sum = 0;
        for await (const part of value) sum += part;
        return sum;
    }
    if (value[Symbol.iterator]) {
        let sum = 0;
        for (const part of value) sum += part;
        return sum;
    }
    return await value;
}

const sums = {};
for (let round = 0; round < 200; round++) {
    for (const name of Object.keys(table)) {
        sums[name] = (sums[name] ?? 0) + (await total(below(round % 5, name))) + (await total(Reflect.apply(table[name], undefined, [1, 2, 3, 4, 5, 6, 7])));
    }
}
console.log(JSON.stringify(sums, null, 1));
