class Node { v: number; constructor(v: number) { this.v = v; } is(n: number): number { return this.v + n; } take(other: Node): number { return other.v; } }
const table: Record<string, Node> = { a: new Node(1), b: new Node(2.5) };
function at(k: string): number { const m = table[k]; try { return m ? m.is(1) + m.v : -1; } catch (e) { return -2; } }
function only(k: string): number { const m = table[k]; try { return m ? m.is(1) : -1; } catch (e) { return -2; } }
const keys = (JSON.parse('"a b c a b"') as string).split(" ");
let out = "";
for (let r = 0; r < 3; r++) for (let i = 0; i < keys.length; i++) out += at(keys[i]!) + "," + only(keys[i]!) + " ";
console.log(`SAID ${out}`);
export {};
