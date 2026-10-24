// A variable of the module, or one that a closure has captured, read in a loop: what the loop leaves alone, and every way it may change under the loop's feet.
const lines: string[] = [];
function show(label: string, ...values: unknown[]): void {
    lines.push(label + ": " + values.map(String).join(" "));
}

let text = "";
let limit = 0;
let turns = 0;
text = "hello, world";
limit = 5;

function leftAlone(): number {
    let sum = 0;
    for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i);
    return sum;
}

function nested(): number {
    let sum = 0;
    for (let r = 0; r < limit; r++) {
        for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
    }
    return sum;
}

function storedToInTheLoop(): string {
    let seen = "";
    for (let i = 0; i < text.length && i < 8; i++) {
        seen += text[i];
        if (i === 2) text = "HELLO, WORLD AGAIN";
    }
    return seen + "|" + text;
}

function shorten(): void {
    text = text.slice(1);
}
function storedToByACall(): string {
    let seen = "";
    for (let i = 0; i < text.length; i++) {
        seen += text[i];
        shorten();
    }
    return seen + "|" + text;
}

function storedToInTheOuterLoop(): number {
    let sum = 0;
    for (let r = 0; r < 3; r++) {
        for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i);
        text += "!";
    }
    return sum;
}

const holder = {
    get next(): number {
        limit--;
        return limit;
    },
};
function storedToByAGetter(box: { readonly next: number }): number {
    let count = 0;
    for (let i = 0; i < limit; i++) count += box.next;
    return count;
}

function storedToByValueOf(amount: any): number {
    let count = 0;
    for (let i = 0; i < limit; i++) count += amount * 1;
    return count;
}

function neverEntered(): number {
    let sum = 0;
    for (let i = 10; i < limit; i++) sum += text.length;
    return sum;
}

function leftByAThrow(): string {
    let i = 0;
    try {
        for (; i < text.length; i++) {
            if (text.charCodeAt(i) === 33) throw new Error("at " + i);
            turns++;
        }
    } catch (error) {
        return (error as Error).message + " after " + turns;
    }
    return "none after " + turns;
}

function* yielding(): Generator<number, number, void> {
    let sum = 0;
    for (let i = 0; i < text.length; i++) {
        sum += text.charCodeAt(i);
        yield sum;
    }
    return sum;
}

async function awaiting(): Promise<string> {
    let seen = "";
    for (let i = 0; i < text.length && i < 6; i++) {
        seen += text[i];
        await null;
    }
    return seen;
}

function makeScanner(first: string) {
    let source = first;
    let pos = 0;
    let end = first.length;
    return {
        setText(next: string): void {
            source = next;
            pos = 0;
            end = next.length;
        },
        sum(): number {
            let sum = 0;
            for (let i = 0; i < source.length; i++) sum += source.charCodeAt(i);
            return sum;
        },
        skipDigits(): number {
            while (pos < end) {
                const c = source.charCodeAt(pos);
                if (c < 48 || c > 57) break;
                pos++;
            }
            return pos;
        },
        restartsHalfway(other: string): string {
            let seen = "";
            for (let i = 0; i < source.length && seen.length < 10; i++) {
                seen += source[i];
                if (i === 1) this.setText(other);
            }
            return seen;
        },
        position(): number {
            return pos;
        },
    };
}

function readsBeforeItIsThere(): string {
    try {
        let sum = 0;
        for (let i = 0; i < 3; i++) sum += late.length;
        return "read " + sum;
    } catch (error) {
        return (error as Error).name;
    }
}

show("left alone", leftAlone(), leftAlone());
show("nested", nested());
show("stored to in the loop", storedToInTheLoop());
show("stored to by a call", storedToByACall());
text = "ab";
show("stored to in the outer loop", storedToInTheOuterLoop(), text);
limit = 6;
show("stored to by a getter", storedToByAGetter(holder), limit);
limit = 6;
show("stored to by valueOf", storedToByValueOf({ valueOf() { limit -= 2; return 10; } }), limit);
show("never entered", neverEntered());
show("left by a throw", leftByAThrow(), turns);
const steps = yielding();
show("yielding", steps.next().value, steps.next().value);
text = "zz";
show("yielding, the text changed", steps.next().value, steps.next().done);
const scanner = makeScanner("123abc");
show("scanner", scanner.sum(), scanner.skipDigits(), scanner.position(), scanner.skipDigits());
scanner.setText("77");
show("scanner, another text", scanner.sum(), scanner.skipDigits(), scanner.position());
show("scanner, restarted halfway", scanner.restartsHalfway("wxyz"), scanner.sum());
show("before it is there", readsBeforeItIsThere());
let late = "late";
show("when it is there", readsBeforeItIsThere());
text = "abcdefgh";
const waiting = awaiting();
text = "AB";
waiting.then(seen => {
    show("awaiting, the text changed", seen);
    console.log(lines.join("\n"));
});
