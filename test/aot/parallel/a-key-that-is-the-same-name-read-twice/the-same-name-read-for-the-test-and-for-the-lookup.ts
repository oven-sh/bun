export {};
class Entry { constructor(public label: string, public other: string) {} }
class Turning { private turns = 0; get label(): string { return this.turns++ & 1 ? "b" : "a"; } }
const labels = ["a", "zz", "b", "a", "c", "b"];
const entries: Entry[] = []; for (let i = 0; i < labels.length; i++) entries.push(new Entry(labels[i]!, labels[(i + 1) % labels.length]!));
function fill(): Map<string, string> { const m = new Map<string, string>(); m.set("a", "at a"); m.set("b", "at b"); m.set("c", "at c"); return m; }
function read(): string { const m = new Map<string, string>(); m.set("a", "at a"); m.set("b", "at b"); m.set("c", "at c"); let s = ""; for (let i = 0; i < entries.length; i++) { const e = entries[i]!; if (m.has(e.label)) s += m.get(e.label) + ";"; else s += "-;"; } return s; }
function otherName(): string { const m = new Map<string, string>(); m.set("a", "at a"); m.set("b", "at b"); m.set("c", "at c"); let s = ""; for (let i = 0; i < entries.length; i++) { const e = entries[i]!; if (m.has(e.label)) s += m.get(e.other) + ";"; else s += "-;"; } return s; }
function otherObject(): string { const m = new Map<string, string>(); m.set("a", "at a"); m.set("b", "at b"); m.set("c", "at c"); let s = ""; for (let i = 0; i < entries.length; i++) { const e = entries[i]!; const f = entries[(i + 2) % entries.length]!; if (m.has(e.label)) s += m.get(f.label) + ";"; else s += "-;"; } return s; }
function storedBetween(): string { const m = new Map<string, string>(); m.set("a", "at a"); m.set("b", "at b"); m.set("c", "at c"); const e = new Entry("a", "b"); let s = ""; for (let i = 0; i < 4; i++) { e.label = i & 1 ? "a" : "c"; if (m.has(e.label)) { e.label = "b"; s += m.get(e.label) + ";"; } } return s; }
function deletedBetween(): string { const m = new Map<string, string>(); m.set("a", "at a"); m.set("b", "at b"); m.set("c", "at c"); let s = ""; for (let i = 0; i < entries.length; i++) { const e = entries[i]!; if (m.has(e.label)) { m.delete(e.label); s += m.get(e.label) + ";"; } else s += "-;"; } return s + m.size; }
function clearedBetween(): string { const m = new Map<string, string>(); m.set("a", "at a"); m.set("b", "at b"); m.set("c", "at c"); let s = ""; for (let i = 0; i < entries.length; i++) { const e = entries[i]!; if (m.has(e.label)) { m.clear(); s += m.get(e.label) + ";"; } else s += "-;"; } return s + m.size; }
function grownBetween(): string { const m = new Map<string, string>(); m.set("a", "at a"); m.set("b", "at b"); m.set("c", "at c"); let s = ""; for (let i = 0; i < entries.length; i++) { const e = entries[i]!; if (m.has(e.label)) { for (let j = 0; j < 40; j++) m.set("more " + i + " " + j, "x"); s += m.get(e.label) + ";"; } else s += "-;"; } return s + m.size; }
function getter(): string { const m = fill(); const t = new Turning(); let s = ""; for (let i = 0; i < 4; i++) { if (m.has(t.label)) s += m.get(t.label) + ";"; } return s; }
function tell(name: string, run: () => string): void { let said: string; try { said = run(); } catch (e) { said = "threw " + (e as Error).name; } console.log(name + ": " + said); }
tell("read", read); tell("otherName", otherName); tell("otherObject", otherObject); tell("storedBetween", storedBetween); tell("deletedBetween", deletedBetween); tell("clearedBetween", clearedBetween); tell("grownBetween", grownBetween); tell("getter", getter);
console.log("end");
