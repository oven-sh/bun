// `"p" + x + y` with x a symbol and y an object: `"p" + x` throws the TypeError, so y is never converted: that is the language, and what compiled code does.
// Todo: plain Bun's own quirk, and ours is kept (main, 11-03 15:50): JavaScriptCore converts every operand of such a chain to a primitive first and joins afterward, so plain Bun calls y.valueOf() BEFORE the TypeError and logs "yv" in the first case where compiled code logs "". Older than the port: the same with and without string-builders-2 and -3.
let log = "";
function noisy(name: string, text: unknown) {
    return {
        toString() {
            log += name + "s";
            return text;
        },
        valueOf() {
            log += name + "v";
            return text;
        },
    };
}

function tell(made: () => unknown) {
    try {
        console.log(made());
    } catch (thrown) {
        console.log("caught " + (thrown as Error).name);
    }
    console.log(JSON.stringify(log));
    log = "";
}

function plus(x: unknown, y: unknown) {
    return "p" + x + y;
}

function between(x: unknown, y: unknown) {
    return "a" + x + "b" + y + "c";
}

function grouped(x: any, y: any) {
    return "p" + (x + y);
}

function template(x: unknown, y: unknown) {
    return `p${x as string}${y as string}`;
}

for (const join of [plus, between, grouped, template]) {
    tell(() => join(Symbol("s"), noisy("y", "Y")));
    tell(() => join(noisy("x", "X"), Symbol("s")));
}
