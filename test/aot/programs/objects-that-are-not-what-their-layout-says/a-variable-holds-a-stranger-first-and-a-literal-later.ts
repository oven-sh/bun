interface Settings { level: number; name: string }
let current = Object.create({ name: "from above" }) as Settings;
Object.defineProperty(current, "level", { get() { return 7; }, enumerable: true });
function show(): string { return current.level + " " + current.name; }
console.log(show());
current = { level: 1, name: "literal" };
console.log(show());
current = Object.assign(Object.create(null), { level: 2, name: "no prototype" }) as Settings;
console.log(show(), Object.getPrototypeOf(current));
