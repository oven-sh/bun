// In a loop a string is joined with elements of a list of which nothing is written: numbers and texts for many turns, then a hole, an object whose conversion changes the list, and a symbol.
let log = "";
function keys(list: unknown[]): string {
    let last = "";
    let count = 0;
    for (let i = 0; i < list.length; i++) {
        last = "k" + list[i] + ";";
        count += last.length;
    }
    return last + count;
}

function deed(list: unknown[]) {
    try {
        console.log(keys(list), log, list.length);
    } catch (error) {
        console.log((error as Error).name, log, list.length);
    }
    log = "";
}

const plain: unknown[] = [];
for (let i = 0; i < 300; i++)
    plain.push(i % 3 ? i : "t" + i);
deed(plain);
deed([]);
deed([1, , 3]);
deed([null, undefined, true, -0, 10n]);
const grows: unknown[] = [1, { toString() { log += "s"; if (grows.length < 5) grows.push("pushed"); return "grew"; } }, 2];
deed(grows);
const shrinks: unknown[] = [1, { toString() { log += "s"; shrinks.length = 2; return "shrank"; } }, 2, 3];
deed(shrinks);
deed([1, Symbol("s"), { toString() { log += "never"; return ""; } }]);
deed(plain);
