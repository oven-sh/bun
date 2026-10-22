// The function that a call enters is read before the arguments are computed. Whatever an argument does to the method comes too late for the call under way, and is seen by the next one.
// Every case has a class of its own, and the name of the method reaches the code that changes it as a text nobody knows.
declare const console: { log(...values: any[]): void };
const name: string = JSON.parse('"of"'), className: string = JSON.parse('"C"');
const lines: string[] = [];
let act: (() => void) | undefined;
function argument(value: number): number { const now = act; act = undefined; if (now) now(); return value; }
function other(label: string) { return function (this: any, value: unknown) { return label + " " + String(value) + " " + this.name; }; }
function attempt(run: () => unknown): string { try { return String(run()); } catch (error) { return "throws " + (error as Error).name; } }
function show(title: string, run: () => unknown, change: () => void): void {
    const seen = [attempt(run), attempt(run)];
    act = change;
    seen.push(attempt(run), attempt(run));
    lines.push(title + ": " + seen.join(" | "));
}

class OnPrototype { name = "a"; of(value: number): string { return "first " + value + " " + this.name; } }
const onPrototype = new OnPrototype();
function callOnPrototype(): string { return onPrototype.of(argument(1)); }
show("replaced on the prototype", callOnPrototype, () => { (OnPrototype.prototype as any)[name] = other("second"); });

class OnInstance { name = "b"; of(value: number): string { return "first " + value + " " + this.name; } }
const onInstance = new OnInstance();
function callOnInstance(): string { return onInstance.of(argument(2)); }
show("hidden on the instance", callOnInstance, () => { (onInstance as any)[name] = other("own"); });

class OtherPrototype { name = "c"; of(value: number): string { return "first " + value + " " + this.name; } }
const otherPrototype = new OtherPrototype();
function callOtherPrototype(): string { return otherPrototype.of(argument(3)); }
show("another prototype", callOtherPrototype, () => { Object.setPrototypeOf(otherPrototype, { [name]: other("elsewhere") }); });

class Deleted { name = "d"; of(value: number): string { return "first " + value + " " + this.name; } }
const deleted = new Deleted();
const bag = { armed: false, get value(): number { if (this.armed) delete (Deleted.prototype as any)[name]; return 4; } };
function callDeleted(): string { return deleted.of(bag.value); }
lines.push("deleted by a getter in the argument: " + [attempt(callDeleted), (bag.armed = true, attempt(callDeleted)), attempt(callDeleted)].join(" | "));

class Thrown { name = "e"; of(value: number): string { return "first " + value + " " + this.name; } }
const thrown = new Thrown();
function callThrown(): string { return thrown.of(argument(5)); }
show("the argument throws", callThrown, () => { (Thrown.prototype as any)[name] = other("second"); throw new RangeError("from the argument"); });

class Parent { name = "f"; of(value: number): string { return "parent " + value + " " + this.name; } }
class Heir extends Parent { go(): string { return super.of(argument(6)); } inherited(): string { return this.of(argument(7)); } }
const heir = new Heir();
show("super", () => heir.go(), () => { (Parent.prototype as any)[name] = other("second parent"); });
class Parent2 { name = "g"; of(value: number): string { return "parent " + value + " " + this.name; } }
class Heir2 extends Parent2 { inherited(): string { return this.of(argument(7)); } }
const heir2 = new Heir2();
show("inherited, hidden on the heir's prototype", () => heir2.inherited(), () => { (Heir2.prototype as any)[name] = other("heir's"); });

class Optional { name = "h"; of(value: number): string { return "first " + value + " " + this.name; } }
const optional: Optional = new Optional();
function callOptional(): string | undefined { return optional.of?.(argument(8)); }
show("optional call", callOptional, () => { (Optional.prototype as any)[name] = undefined; });

class Tagged { name = "i"; of(strings: TemplateStringsArray, value: number): string { return "first " + strings.join("_") + value + " " + this.name; } }
const tagged = new Tagged();
function callTagged(): string { return tagged.of`x${argument(9)}y`; }
show("tagged template", callTagged, () => { (Tagged.prototype as any)[name] = other("second"); });

class First { kind = "first"; constructor(public value: number) { } }
class Second { kind = "second"; constructor(public value: number) { } }
class Holder { C: typeof First | typeof Second = First; }
const holder = new Holder();
function construct(): string { const made = new holder.C(argument(10)); return made.kind + " " + made.value; }
show("new o.C(..)", construct, () => { (holder as any)[className] = Second; });

class Awaited { name = "j"; of(value: number): string { return "first " + value + " " + this.name; } }
const awaited = new Awaited();
let release: ((value: number) => void) | undefined;
async function callAwaited(): Promise<string> { return awaited.of(await new Promise<number>(resolve => { release = resolve; })); }

class Yielded { name = "k"; of(value: number): string { return "first " + value + " " + this.name; } }
const yielded = new Yielded();
function* callYielded(): Generator<number, string, number> { return yielded.of(yield 0); }

(globalThis as any).kept = [OnPrototype, OnInstance, OtherPrototype, Deleted, Thrown, Parent, Heir, Parent2, Heir2, Optional, Tagged, Holder, Awaited, Yielded];
(async () => {
    const seen: string[] = [];
    for (const change of [false, false, true, false]) {
        const pending = callAwaited();
        if (change) (Awaited.prototype as any)[name] = other("second");
        release!(11);
        seen.push(await pending);
    }
    lines.push("await in the argument: " + seen.join(" | "));
    const steps: string[] = [];
    for (const change of [false, false, true, false]) {
        const generator = callYielded();
        generator.next();
        if (change) (Yielded.prototype as any)[name] = other("second");
        steps.push(String(generator.next(12).value));
    }
    lines.push("yield in the argument: " + steps.join(" | "));
    console.log(lines.join("\n"));
})();
