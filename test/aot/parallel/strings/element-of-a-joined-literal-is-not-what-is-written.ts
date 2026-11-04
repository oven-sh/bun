// A list literal is joined where it is written, and an element that is written as a string is undefined, null, a list, an object that converts, a symbol: join() takes the first two for nothing, and converts the others in their order.
let log = "";
function path(folder: string, name: string, version: number): string {
    return [folder, name, version].join("/");
}

function noisy(name: string) {
    return { toString() { log += name; return name.toUpperCase(); } };
}

function deed(folder: unknown, name: unknown, version: unknown) {
    try {
        console.log(path(folder as string, name as string, version as number), log);
    } catch (error) {
        console.log((error as Error).name, log);
    }
    log = "";
}

deed("a", "b", 1);
deed("", "", -0);
deed(undefined, "b", 1);
deed("a", null, undefined);
deed(["x", ["y", null]], "b", 1);
deed(noisy("f"), noisy("n"), noisy("v"));
deed(noisy("f"), Symbol("s"), noisy("v"));
deed(10n, true, NaN);
for (let turn = 0; turn < 3; turn++)
    deed("t" + turn, turn === 1 ? undefined : "n", turn);
deed("a", "b", 1);
