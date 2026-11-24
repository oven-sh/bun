var shelf = new ArrayBuffer(256);
var words = new Int32Array(shelf), counts = new Uint32Array(shelf), prices = new Float32Array(shelf);
var bytes = new Uint8Array(shelf), letters = new Int8Array(shelf);

function lay(size) {
    shelf = new ArrayBuffer(size);
    words = new Int32Array(shelf);
    counts = new Uint32Array(shelf);
    prices = new Float32Array(shelf);
    bytes = new Uint8Array(shelf);
    letters = new Int8Array(shelf);
}

function fill() {
    for (let i = 0; i < counts.length; ++i)
        counts[i] = 3 * i + 1;
}

function countsInside(place, turns) {
    let inside = 0;
    place = place | 0;
    for (let turn = 0; turn < turns; ++turn) {
        const at = (place + (turn << 2)) | 0;
        if (counts[at >> 2] !== undefined)
            inside = (inside + 1) | 0;
        if (counts[(at + 4) >> 2] !== undefined)
            inside = (inside + 16) | 0;
    }
    return inside;
}

function pricesInside(place, turns) {
    let inside = 0;
    place = place | 0;
    for (let turn = 0; turn < turns; ++turn) {
        const at = (place + (turn << 2)) | 0;
        if (prices[at >> 2] !== undefined)
            inside = (inside + 1) | 0;
        if (prices[(at + 4) >> 2] !== undefined)
            inside = (inside + 16) | 0;
    }
    return inside;
}

function lettersInside(place, turns) {
    let inside = 0;
    place = place | 0;
    for (let turn = 0; turn < turns; ++turn) {
        const at = (place + turn) | 0;
        if (letters[at] !== undefined)
            inside = (inside + 1) | 0;
        if (letters[(at + 1) | 0] !== undefined)
            inside = (inside + 16) | 0;
    }
    return inside;
}

function sumOfCounts(turns) {
    let sum = 0;
    for (let turn = 0; turn < turns; ++turn)
        sum = (sum + counts[turn & 31] + counts[(turn + 1) & 31]) | 0;
    return sum;
}

function look(name) {
    const end = counts.byteLength | 0;
    console.log(name, countsInside(0, 4), countsInside(end - 8, 3), countsInside(end, 2));
    console.log(name, pricesInside(0, 4), pricesInside(end - 8, 3), pricesInside(end, 2));
    console.log(name, lettersInside(0, 4), lettersInside(end - 2, 3), lettersInside(end, 2));
    console.log(name, sumOfCounts(40));
}

const given = text => eval(text);

fill();
look("as laid");
for (const text of [
    "words = new Uint8Array(shelf)",
    "words = new Float64Array(shelf)",
    "words = new Int32Array(shelf)",
    "bytes = new Float64Array(shelf)",
    "bytes = new Uint16Array(shelf); words = new Int16Array(shelf)",
    "words = null",
    "words = [1, 2, 3]; bytes = new Uint8Array(shelf)",
    "words = new Int8Array(new ArrayBuffer(512))",
    "words = new Int32Array(shelf, 64)",
]) {
    given(text);
    look(text);
}
lay(128);
fill();
look("laid again");
given("words = new Uint8ClampedArray(shelf)");
look("clamped");
given("lay(512); fill(); words = new Int16Array(shelf)");
look("wider");
