// Species: programs y instanceof through constructor. It prints what plain Bun prints.
class Point { static [Symbol.hasInstance](value: unknown): boolean { return value === 1; } }
const held: any[] = JSON.parse("[]");
held.push(new Point());
console.log((1 as any) instanceof held[0].constructor, ({} as any) instanceof held[0].constructor);
