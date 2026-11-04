// concat() on what is written as a string and String.raw with substitutions that are written as strings meet null, undefined, objects that convert, symbols and a receiver that is no string.
let log = "";
function noisy(name: string) {
    return { toString() { log += name; return name.toUpperCase(); } };
}

function glued(a: string, b: string, c: string): string {
    return a.concat(b, c);
}

function raw(a: string, b: string): string {
    return String.raw`<${a}\n${b}>`;
}

function deed(a: unknown, b: unknown, c: unknown) {
    try {
        console.log(JSON.stringify(glued(a as string, b as string, c as string)), log);
    } catch (error) {
        console.log((error as Error).name, log);
    }
    log = "";
    try {
        console.log(JSON.stringify(raw(a as string, b as string)), log);
    } catch (error) {
        console.log((error as Error).name, log);
    }
    log = "";
}

deed("a", "b", "c");
deed("", "", "");
deed("a", null, undefined);
deed("a", 1, -0);
deed("a", noisy("b"), noisy("c"));
deed(noisy("a"), noisy("b"), noisy("c"));
deed("a", Symbol("s"), noisy("c"));
deed("a", noisy("b"), Symbol("s"));
deed(null, "b", "c");
deed(undefined, noisy("b"), "c");
deed(5, 6, 7);
deed([1, 2], [3], "c");
for (let turn = 0; turn < 3; turn++)
    deed("t" + turn, turn === 1 ? noisy("b") : "b", turn);
deed("a", "b", "c");
