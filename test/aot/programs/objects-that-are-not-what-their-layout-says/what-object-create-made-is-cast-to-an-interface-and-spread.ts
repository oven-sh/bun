interface Settings { level: number; name: string }
const made = Object.create({ name: "from above" }) as Settings;
Object.defineProperty(made, "level", { get() { return 7; }, enumerable: true });
const copy: Settings = { ...made };
const literal: Settings = { level: 1, name: "literal" };
function show(s: Settings): string { return s.level + " " + s.name; }
console.log(show(made), show(copy), show(literal), Object.keys(copy).join());
