class Base {
    active: boolean = false;
    count: number = 0;
    hidden: boolean = false;
    next: Base | null = null;
    ratio: number = 0.5;
    label: string = "base";
    size: number = 1;

    weigh(): number {
        return (this.active ? 1 : 0) + this.count + (this.hidden ? 2 : 0) + (this.next ? this.next.size : 0) + this.ratio + this.label.length + this.size;
    }

    fill(on: boolean, count: number, next: Base | null): this {
        this.active = on;
        this.count = count;
        this.hidden = !on;
        this.next = next;
        this.ratio = count + 0.25;
        this.label = "filled " + count;
        this.size = count + 1;
        return this;
    }

    grow(): void {
        this.count++;
        this.size++;
    }

    show(): string {
        return [String(this.active), String(this.count), String(this.hidden), this.next ? this.next.label : "no next", String(this.ratio), this.label, String(this.size)].join(" ");
    }
}

class Derived extends Base {
    locked: boolean = false;
    depth: number = 2;
    other: Base | null = null;
    sealed: boolean = true;
    scale: number = 1.5;

    override weigh(): number {
        return super.weigh() + (this.locked ? 4 : 0) + this.depth + (this.other ? this.other.count : 0) + (this.sealed ? 8 : 0) + this.scale;
    }

    override show(): string {
        return super.show() + " / " + [String(this.locked), String(this.depth), this.other ? this.other.label : "no other", String(this.sealed), String(this.scale)].join(" ");
    }
}

class Deeper extends Derived {
    last: boolean = true;
    tail: string = "tail";

    override show(): string {
        return super.show() + " / " + String(this.last) + " " + this.tail;
    }
}

function collect(): void {
    let garbage: Base[] = [];
    for (let i = 0; i < 2000; i++)
        garbage.push(new Base());
    garbage = [];
    Bun.gc(true);
}

function labelOfNext(base: Base): string {
    return base.next ? base.next.label : "none";
}

const base = new Base();
const derived = new Derived();
const deeper = new Deeper();
console.log("made", base.show());
console.log("made", derived.show());
console.log("made", deeper.show());
console.log("weights", String(base.weigh()), String(derived.weigh()), String(deeper.weigh()));

base.fill(true, 10, null);
derived.fill(false, 20, base);
deeper.fill(true, 30, derived);
console.log("filled", base.show());
console.log("filled", derived.show());
console.log("filled", deeper.show());
collect();

derived.locked = true;
derived.depth = 21;
derived.other = deeper;
derived.sealed = false;
derived.scale = 21.5;
deeper.locked = true;
deeper.depth = 31;
deeper.other = base;
deeper.last = false;
deeper.tail = "changed";
console.log("own fields", base.show());
console.log("own fields", derived.show());
console.log("own fields", deeper.show());
console.log("weights", String(base.weigh()), String(derived.weigh()), String(deeper.weigh()));
collect();

base.grow();
derived.grow();
deeper.grow();
console.log("grown", base.show());
console.log("grown", derived.show());
console.log("grown", deeper.show());
console.log("next", labelOfNext(base), labelOfNext(derived), labelOfNext(deeper));
console.log("keys", Object.keys(deeper).join(","));

const all: Base[] = [];
for (let i = 0; i < 300; i++) {
    const made = i % 3 === 0 ? new Base() : i % 3 === 1 ? new Derived() : new Deeper();
    made.fill((i & 1) === 1, i, all.length ? all[all.length - 1] : null);
    all.push(made);
    if (i % 100 === 99)
        collect();
}
let sum = 0;
for (const each of all) {
    each.grow();
    sum += each.weigh();
}
console.log("sum", String(sum));
console.log("one of each", all[150].show(), "//", all[151].show(), "//", all[152].show());
