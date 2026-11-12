// Under legacy decorators a decorated static field is assigned behind its class, in the function around it: inside a constructor its `this` is the object that is being made, and a text evaluated there sees it.
function mark(target: unknown, key: string): void {}
function show(object: unknown): string { return JSON.stringify(Object.entries(object as object)); }
class Page { title: string; count: number; constructor(title: string) { class Inner { @mark static held: unknown = eval("this"); } console.log(show(Inner.held)); this.title = title; this.count = 1; } }
class ByAnArrow { title: string; count: number; constructor(title: string) { class Inner { @mark static held: () => unknown = () => eval("this"); } console.log(show(Inner.held())); this.title = title; this.count = 1; } }
class WithProperty { count: number; constructor(public title: string) { class Inner { @mark static held: unknown = eval("this"); } console.log(show(Inner.held)); this.count = 1; } }
class Amid { title: string; count: number; constructor(title: string) { this.title = title; console.log(show(eval("this"))); this.count = 1; } }
console.log(show(new Page("a")), show(new ByAnArrow("b")), show(new WithProperty("c")), show(new Amid("d")));
