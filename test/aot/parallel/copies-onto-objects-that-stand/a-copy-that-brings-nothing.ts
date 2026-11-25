interface Half { left: number; label: string }
interface Both { left: number; label: string; depth?: number }
let kept: Both = { left: 1, label: "b" };
const first: Half = JSON.parse('{"left":1,"label":"b"}');
function run(n: number): number { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { const none: { depth?: number } = {}; kept = { ...first, ...none }; s = (s + kept.left) | 0; } return s; }
console.log("SAID " + run(JSON.parse(process.env.B1550_TURNS ?? "3")) + " " + Object.keys(kept).join() + " " + typeof kept.left + typeof kept.label); export {};
