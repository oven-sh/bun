const told: string[] = [];

function tell(name: string, ask: () => any): void {
    try {
        told.push(name + " " + typeof ask());
    } catch (error: any) {
        told.push(name + " " + (error instanceof TypeError ? "TypeError" : "another error"));
    }
}

function first(value: any, context: any): any {
    tell("first " + String(context.name), value);
    return undefined;
}

function later(value: any, context: any): any {
    told.push("later " + String(context.name) + " " + context.kind);
    return undefined;
}

class Crate {
    @first static callsMethod(): any {
        return Crate.#method(1);
    }
    @first static readsMethod(): any {
        return Crate.#method;
    }
    @first static getsGetter(): any {
        return Crate.#getter;
    }
    @first static setsSetter(): any {
        return (Crate.#setter = 4);
    }
    @first static getsAccessor(): any {
        return Crate.#accessor;
    }
    @first static setsAccessor(): any {
        return (Crate.#accessor = 4);
    }
    @first static asksMethod(): any {
        return #method in Crate;
    }
    @first static callsOwn(): any {
        return new Crate().#own(1);
    }
    @first static getsOwn(): any {
        return new Crate().#ownGetter;
    }
    @first static setsOwn(): any {
        return (new Crate().#ownSetter = 4);
    }
    @first static getsOwnAccessor(): any {
        return new Crate().#ownAccessor;
    }
    @first static callsPlain(): any {
        return Crate.#plain(2);
    }
    @first static loops(): any {
        let sum = 0;
        for (let turn = 0; turn < 3; ++turn) {
            try {
                sum += Crate.#method(turn);
            } catch (error) {
                sum += 100;
            }
        }
        return sum === 300 ? "three" : sum;
    }
    static #plain(n: number): number {
        return n + 7;
    }
    @later static #method(n: number): number {
        return n + 3;
    }
    @later static get #getter(): number {
        return 3;
    }
    @later static set #setter(value: number) {
        told.push("set " + value);
    }
    @later static accessor #accessor: number = 3;
    @later #own(n: number): number {
        return n + 3;
    }
    @later get #ownGetter(): number {
        return 3;
    }
    @later set #ownSetter(value: number) {
        told.push("set own " + value);
    }
    @later accessor #ownAccessor: number = 3;
}

const asked: [string, () => any][] = [
    ["callsMethod", Crate.callsMethod],
    ["readsMethod", Crate.readsMethod],
    ["getsGetter", Crate.getsGetter],
    ["setsSetter", Crate.setsSetter],
    ["getsAccessor", Crate.getsAccessor],
    ["setsAccessor", Crate.setsAccessor],
    ["asksMethod", Crate.asksMethod],
    ["callsOwn", Crate.callsOwn],
    ["getsOwn", Crate.getsOwn],
    ["setsOwn", Crate.setsOwn],
    ["getsOwnAccessor", Crate.getsOwnAccessor],
    ["callsPlain", Crate.callsPlain],
    ["loops", Crate.loops],
];
for (const [name, ask] of asked)
    tell("then " + name, ask);

function makeShelf(size: number): any {
    class Shelf {
        @first static reads(): any {
            return Shelf.#count(size);
        }
        @first static makes(): any {
            return new Shelf().#width;
        }
        @later static #count(n: number): number {
            return n + size;
        }
        @later get #width(): number {
            return size;
        }
    }
    return [Shelf.reads(), Shelf.makes()];
}

for (let turn = 1; turn < 4; ++turn)
    told.push("shelf " + makeShelf(turn).join(" "));

const Drawer = class {
    @first static opens(): any {
        return this === undefined ? "no class" : "class";
    }
    @later static #depth(): number {
        return 5;
    }
    static deep(): number {
        return this.#depth();
    }
};
told.push("drawer " + Drawer.deep());

console.log(told.join("\n"));
