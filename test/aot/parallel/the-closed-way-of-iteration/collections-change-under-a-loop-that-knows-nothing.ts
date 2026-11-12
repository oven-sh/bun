(globalThis as any).shelf = { set: () => new Set([1, 2, 3]), map: () => new Map([[1, "a"], [2, "b"], [3, "c"]]) };
const shelf: any = (globalThis as any).shelf;
function grows(items: any): string { let text = ""; for (const item of items) { text += item + ";"; if (items.size < 6) items.add(item + 10); } return text; }
function shrinks(items: any): string { let text = ""; for (const item of items) { text += item + ";"; items.delete(item + 1); } return text; }
function cleared(items: any): string { let text = ""; let turns = 0; for (const item of items) { text += item + ";"; items.clear(); if (turns++ < 2) items.add(item + 100); } return text; }
function ofMap(items: any): string { let text = ""; for (const [key, value] of items) { text += key + value + ";"; if (key < 3) { items.delete(key); items.set(key + 10, value + "x"); } if (text.length > 60) break; } return text; }
function values(items: any): string { let text = ""; for (const value of items.values()) { text += value + ";"; items.delete(2); } return text; }
let out = ""; for (let round = 0; round < 3; round++) out += [grows(shelf.set()), shrinks(shelf.set()), cleared(shelf.set()), ofMap(shelf.map()), values(shelf.map())].join("|") + "\n"; console.log(out);
