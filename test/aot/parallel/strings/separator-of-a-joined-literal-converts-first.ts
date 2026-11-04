// The separator of a join of a list literal is written as a string and is undefined, null, a number, an object that converts, a symbol: it is converted once, in front of every element, also where the list has one element or none.
let log = "";
function noisy(name: string) {
    return { toString() { log += name; return name.toUpperCase(); } };
}

function two(a: unknown, separator: string): string {
    return [a, a].join(separator);
}

function one(a: unknown, separator: string): string {
    return [a].join(separator);
}

function none(separator: string): string {
    return [].join(separator);
}

function deed(separator: unknown) {
    try {
        console.log(JSON.stringify(two(noisy("e"), separator as string)), log);
        log = "";
        console.log(JSON.stringify(two("e", separator as string)), JSON.stringify(one("e", separator as string)), JSON.stringify(none(separator as string)), log);
    } catch (error) {
        console.log((error as Error).name, log);
    }
    log = "";
}

deed("-");
deed("");
deed(undefined);
deed(null);
deed(0);
deed(noisy("s"));
deed(Symbol("s"));
for (let turn = 0; turn < 3; turn++)
    deed(turn === 1 ? noisy("s") : "+" + turn);
deed("-");
