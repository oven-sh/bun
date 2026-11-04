// one side has made the object and the other brings a frozen one. The program asks for the opposite of what told the sides apart, and stores on that side
type Point = { x: number; y?: number };
function subject(v: unknown, other: Point) { const isNumber = typeof v === "number"; const o: Point = isNumber ? { x: v } : other; if (!isNumber) o.y = 1; return o; }
function deed(v: unknown, other: Point) { try { return String(subject(v, other).y); } catch (error) { return (error as Error).constructor.name; } }
console.log(deed(1, Object.freeze({ x: 0 })), deed("a", Object.freeze({ x: 0 })), deed("a", { x: 0 }));
let refused = 0;
for (let i = 0; i < 300; i++) refused += deed(i % 3 ? "a" : i, i % 2 ? Object.freeze({ x: i }) : { x: i }) === "TypeError" ? 1 : 0;
console.log(String(refused));
console.log(deed(JSON.parse("1"), Object.freeze({ x: 0 })), deed(JSON.parse("null"), Object.freeze({ x: 0 })));
