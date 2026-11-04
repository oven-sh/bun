// A text grows in a loop that ends by a relation whose operand gets a narrower name on the edge out: the name stands at the head of the block on the edge, in front of what finishes the text.
// Flags: --aot-check=Validate
function codes(text: string): string {
    let seen = "";
    for (let pos = 0; pos <= text.length - 0; pos++)
        seen += text.charCodeAt(pos) + ",";
    return seen;
}

function shape(n: number): string {
    return codes("abcdefghij".repeat(n).slice(0, n));
}

function deed(n: number) {
    console.log(n, shape(n).length, shape(n).slice(0, 24));
}

for (const n of [0, 1, 2, 3, 4, 5, 9, 40, 200])
    deed(n);
