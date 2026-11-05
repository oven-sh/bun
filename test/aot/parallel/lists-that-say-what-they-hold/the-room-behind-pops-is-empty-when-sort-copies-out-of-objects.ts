class Crate {
    tag: string;
    load: number;
    constructor(tag: string, load: number) {
        this.tag = tag;
        this.load = load;
    }
}

function stock(count: number): Crate[] {
    const shelf: Crate[] = [];
    for (let i = 0; i < count; i++)
        shelf.push(new Crate("c" + i, i));
    return shelf;
}

function weighByIndex(shelf: Crate[]): number {
    let sum = 0;
    for (let i = 0; i < shelf.length; i++)
        sum += shelf[i].load;
    return sum;
}

function weighByStep(shelf: Crate[]): number {
    let sum = 0;
    for (const crate of shelf)
        sum += crate.load;
    return sum;
}

function attempt(deed: () => unknown): unknown {
    try {
        return deed();
    } catch (error) {
        return "threw " + (error as Error).name;
    }
}

function room(round: number, collects: boolean): string {
    const shelf = stock(9);
    shelf.pop();
    shelf.pop();
    shelf.pop();
    if (collects)
        Bun.gc(true);
    shelf.sort();
    const before = shelf.length;
    shelf.length += 4;
    let seen = "";
    for (let at = before; at < shelf.length; at++)
        seen += String(shelf[at]) + (at in shelf ? " own " : " hole ");
    return before + " | " + seen + "| " + JSON.stringify(shelf) + " | " + Object.keys(shelf).length;
}

for (let round = 0; round < 3; round++)
    console.log(room(round, false), room(round, true));
