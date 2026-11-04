// Beside a string stands what is written as a number or a string. It is one for many calls, then an object that converts, a symbol, null, a BigInt, and a number again.
let log = "";
function label(x: number | string): string {
    return "id-" + x + "!";
}

function front(x: number | string): string {
    return x + "-id";
}

function deed(x: unknown) {
    try {
        console.log(label(x as number), front(x as string), log);
    } catch (error) {
        console.log((error as Error).name, log);
    }
    log = "";
}

for (let turn = 0; turn < 300; turn++)
    label(turn);
deed(1);
deed("t");
deed({ valueOf() { log += "v"; return 5; }, toString() { log += "s"; return "text"; } });
deed({ [Symbol.toPrimitive](hint: string) { log += hint; return hint; } });
deed({ valueOf() { log += "v"; return {}; }, toString() { log += "s"; return {}; } });
deed(Symbol("s"));
deed(null);
deed(undefined);
deed(true);
deed(10n);
deed([1, [2, 3]]);
deed(-0);
deed(1);
