// The objects of these classes reach run-time text, so nothing is known about what happens to them later. The definitions of a class without a parent still fill the slots of the object
// that its constructor has just allocated; those of a class below a parent find what the parent returns.
// COUNTER: FieldsLeftSlotByStoreOfOtherType >= 1
const seen: unknown[] = [];
function note(value: unknown): void { seen.push(value === undefined ? "undefined" : value); }
const unknownCode = new Function("value", process.argv[2] ?? "return value") as <V>(value: V) => V;

class Slot<T extends object> {
    first = 1;
    readonly #create: () => T;
    second = "two";
    readonly #states = new WeakMap<object, T>();
    third: number[] = [3];
    #count = 0;
    constructor(create: () => T) { this.#create = create; }
    of(key: object): T {
        this.#count++;
        let state = this.#states.get(key);
        if (state === undefined)
            this.#states.set(key, state = this.#create());
        return state;
    }
    get count(): number { return this.#count; }
    static has(value: object): boolean { return #states in value; }
}
const key = {};
const slot = unknownCode(new Slot(() => ({ n: 1 })));
note(slot.of(key).n); note(slot.of(key) === slot.of(key)); note(slot.count);
note(Object.keys(slot).join()); note(JSON.stringify(slot)); note(Reflect.ownKeys(slot).length); note(Object.getOwnPropertyNames(slot).join());
note(Slot.has(slot)); note(Slot.has({})); note(Slot.has(Object.create(slot)));
for (const name in slot) note(name);
note(JSON.stringify({ ...slot }));
(slot as any).fourth = 4; delete (slot as any).first;
note(Object.keys(slot).join()); note(slot.of({}).n); note(slot.count);
Object.freeze(slot);
note(slot.of(key).n); note(slot.count);

class Below extends Slot<{ n: number }> {
    #own = "own";
    extra = 5;
    constructor() { super(() => ({ n: 2 })); }
    get own(): string { return this.#own; }
}
const below = unknownCode(new Below());
note(below.of(key).n); note(below.count); note(below.own); note(Object.keys(below).join()); note(Slot.has(below));

class Returning { constructor(given: object) { return given; } }
class Stamp extends Returning {
    #mark = "mark";
    static read(value: object): unknown { return #mark in value ? (value as Stamp).#mark : "absent"; }
}
note(Stamp.read(slot)); new Stamp(below); note(Stamp.read(below)); note(Object.keys(below).join());
try { new Stamp(below); } catch (error) { note((error as Error).constructor.name); }
unknownCode(new Stamp({}));

function evaluate(step: number) {
    return class Evaluated { #step = step; #twice = step * 2; get sum(): number { return this.#step + this.#twice; } static has(value: object): boolean { return #step in value; } };
}
const One = evaluate(1), Two = evaluate(2);
const one = unknownCode(new One()), two = unknownCode(new Two());
note(one.sum); note(two.sum); note(One.has(two)); note(Two.has(two)); note(One.has(one));

let total = 0;
for (let i = 0; i < 2000; i++)
    total += unknownCode(new Slot(() => [i])).of(key)[0];
note(total);
note(Reflect.construct(Slot, [() => ({ n: 7 })], Below) instanceof Below);
note((Reflect.construct(Slot, [() => ({ n: 7 })], Below) as Slot<{ n: number }>).of(key).n);
try { note((Reflect.construct(Slot, [() => ({ n: 7 })], Below) as Below).own); } catch (error) { note((error as Error).constructor.name); }

// A value outside the type of the field takes the field out of its slot. The name is still there, and an empty slot alone does not say that it is not.
class Odd {
    #n: number = 1; #s = "s";
    set(value: unknown): void { this.#n = value as number; }
    get n(): unknown { return this.#n; }
    static has(value: object): boolean { return #n in value; }
    static hasOther(value: object): boolean { return #s in value; }
}
const odd = unknownCode(new Odd());
note(Odd.has(odd)); note(odd.n);
odd.set(unknownCode("text"));
note(Odd.has(odd)); note(Odd.hasOther(odd)); note(odd.n);
odd.set(5);
note(Odd.has(odd)); note(Odd.hasOther(odd)); note(odd.n); note(Odd.has({})); note(Odd.has(Object.create(odd)));

console.log(seen.join(" | "));
