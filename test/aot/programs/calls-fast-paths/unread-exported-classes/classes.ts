const made: string[] = [];
function note(what: string): string { made.push(what); return what; }
export function whatWasMade(): string { return made.join(","); }

export class Unread {
    value = 1;
    method(): string { return "only in the unread class"; }
    get twice(): number { return this.value * 2; }
    static make(): Unread { return new Unread(); }
}
export class Read { value = 2; method(): string { return "in the class that is read"; } }
export class MadeByAFunction { method(): string { return "in the class that a function makes"; } }
export function makes(): MadeByAFunction { return new MadeByAFunction(); }
export class Parent { method(): string { return "in the parent of a class that is read"; } }
export class Child extends Parent { other(): string { return "in the child"; } }
export class OnlyItsStaticMethodIsCalled {
    static answer(): string { return "in the static method that is called"; }
    method(): string { return "beside the static method that is called"; }
}
export class UnreadWithAStaticField {
    static field: string = note("the static field is initialized");
    method(): string { return "in the unread class with a static field"; }
}
