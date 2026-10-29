const other: any = { color: Symbol.for("none") };
const more: any = { color: null, next: undefined };
const level: unknown = { level: 4n };
console.log(String(other.color), more.color, more.next, level);
export {};
