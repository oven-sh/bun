// What a small method hands back is compared, added to, tested and stored right where the method is called: the way hand-written parsers read their input.
class Reader {
    pos = 0;
    constructor(readonly text: string) {}
    peek(): number { return this.text.charCodeAt(this.pos); }
    peekAt(offset: number): number { return this.text.charCodeAt(this.pos + offset); }
    atEnd(): boolean { return this.pos >= this.text.length; }
    rest(): string { return this.text.slice(this.pos); }
    current(): string | undefined { return this.atEnd() ? undefined : this.text[this.pos]; }
    half(): number { return this.pos / 2; }
    self(): Reader { return this; }
    words(): string[] { return this.rest().split(" "); }

    countSpaces(): number {
        let spaces = 0;
        for (this.pos = 0; !this.atEnd(); this.pos++) if (this.peek() === 32) spaces++;
        return spaces;
    }
    countDigits(): number {
        let digits = 0;
        for (this.pos = 0; !this.atEnd(); this.pos++) if (this.peek() >= 48 && this.peek() <= 57) digits++;
        return digits;
    }
    sum(): number {
        let sum = 0;
        for (this.pos = 0; !this.atEnd(); this.pos++) sum += this.peek() + 1;
        return sum;
    }
    number(): number {
        let value = 0;
        while (!this.atEnd() && this.peek() >= 48 && this.peek() <= 57) value = value * 10 + (this.peek() - 48), this.pos++;
        return value;
    }
    pastTheEnd(): string {
        this.pos = this.text.length;
        return [this.peek() === 32, this.peek() !== 32, this.peek() < 32, this.peek() >= 32, this.peek() === this.peek(), Number.isNaN(this.peek() + 1), this.peek() ? "truthy" : "falsy", this.peek() | 0].join();
    }
    halves(): string {
        const seen: unknown[] = [];
        for (this.pos = 0; this.pos < 5; this.pos++) seen.push(this.half() === 1, this.half() < 1.5, this.half() + 0.5, this.half() ? 1 : 0, this.half() | 0);
        return seen.join();
    }
    strings(): string {
        this.pos = this.text.length - 3;
        const seen: unknown[] = [this.rest() === "4 5", this.rest() + "!", this.rest().length, this.rest() < "5", this.rest() ? "some" : "none", typeof this.rest()];
        this.pos = this.text.length;
        seen.push(this.rest() === "", this.rest() ? "some" : "none", this.current() === undefined, this.current() ?? "nothing", typeof this.current());
        this.pos = 0;
        seen.push(this.current() === "a", this.current() + "?", this.current() ? "some" : "none");
        return seen.join();
    }
    objects(): string {
        this.pos = 2;
        return [this.self() === this, this.self().pos, this.self().self().peek(), this.words().length, this.words()[0], this.self() ? "object" : "nothing"].join();
    }
}

class Shouting extends Reader {
    peek(): number { return super.peek() & ~32; }
    rest(): string { return super.rest().toUpperCase(); }
}

class Shifted extends Reader {
    peek(): number { return super.peek() + 0.5; }
    atEnd(): boolean { return this.pos + 1 >= this.text.length; }
}

function describe(label: string, reader: Reader) {
    console.log(label, reader.countSpaces(), reader.countDigits(), reader.sum(), reader.pastTheEnd(), reader.halves());
    console.log(label, reader.strings(), reader.objects());
    reader.pos = reader.text.indexOf("1");
    console.log(label, reader.number(), reader.pos);
}

const text = "a bc  def 123 4 5";
describe("reader", new Reader(text));
describe("shouting", new Shouting(text));
describe("shifted", new Shifted(text));
const readers: Reader[] = [new Reader(text), new Shouting("x y"), new Shifted("1 2 3"), new Reader("")];
let total = 0;
for (let round = 0; round < 1000; round++) for (const reader of readers) total += reader.countSpaces() * 3 + reader.countDigits() + (reader.sum() & 7);
console.log("in turn", total);
