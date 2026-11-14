// Mixins with types, called where a name of theirs is declared again.
type Constructor<T = {}> = new (...args: any[]) => T;
interface Settings { level: number }
let settings: Settings = { level: 1 };
const registry: string[] = [];
function Tracked<T extends Constructor>(Base: T) { return class extends Base { level(): number { return settings.level; } note(text: string): number { return registry.push(text); } }; }
const Timed = <T extends Constructor>(Base: T) => class extends Base { at: number = settings.level; names(): string { return registry.join(); } };
class Plain { plain = true; }
const A = ((settings: Settings) => Tracked(Plain))({ level: 7 });
const B = Tracked(class {});
const C = ((registry: string[]) => ((settings: Settings) => Timed(Plain))({ level: 9 }))(["inner"]);
class D extends Timed(Plain) {}
const E = class registry extends Tracked(Plain) { static own(): string { return registry.name; } };
console.log(new A().level(), new B().level(), new A().note("a"), new B().note("b"), new E().note("e"), E.own());
console.log(new C().at, new C().names(), new D().at, new D().names(), new D().plain, new C().plain);
settings = { level: 3 };
console.log(new A().level(), new B().level(), new C().at, new D().at, new E().level(), registry.length);
