const report = value => console.log(typeof value === "string" ? value : Object.is(value, -0) ? "-0" : String(value));
import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage();
const log = [];
const note = (text) => log.push(text + " in " + storage.getStore());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function* source(name, limit) {
    note(name + " starts");
    for (let number = 0; number < limit; number++) {
        if (number === 1)
            await undefined;
        if (number === 2)
            await tick();
        note(name + " yields " + number);
        yield number;
        note(name + " goes on behind " + number);
    }
}
async function* around(name, inner) {
    note(name + " starts");
    yield* inner;
    note(name + " ends");
}
async function* forwards(name, inner) {
    for await (const value of inner) {
        note(name + " forwards " + value);
        yield value;
    }
}
async function consume(name, iterable) {
    for await (const value of iterable) {
        note(name + " got " + value);
        if (value === 1)
            await undefined;
    }
    note(name + " is through");
}

async function main() {
    await storage.run("A", () => consume("a", source("one", 4)));
    const madeInB = storage.run("B", () => source("two", 4));
    await storage.run("C", () => consume("b", madeInB));
    const begunInD = source("three", 4);
    await storage.run("D", () => begunInD.next());
    await storage.run("E", () => consume("c", begunInD));
    await storage.run("F", () => consume("d", storage.run("G", () => around("four", storage.run("H", () => source("five", 3))))));
    await storage.run("I", () => consume("e", storage.run("J", () => forwards("six", storage.run("K", () => source("seven", 3))))));
    await Promise.all([storage.run("L", () => consume("f", source("eight", 3))), storage.run("M", () => consume("g", source("nine", 3)))]);
    const shared = source("ten", 6);
    await Promise.all([storage.run("N", () => consume("h", shared)), storage.run("O", () => consume("i", shared))]);
    await consume("j", storage.run("P", () => source("eleven", 2)));
    storage.enterWith("Q");
    await consume("k", source("twelve", 3));
}

main().then(() => {
    for (const line of log)
        report(line);
});
