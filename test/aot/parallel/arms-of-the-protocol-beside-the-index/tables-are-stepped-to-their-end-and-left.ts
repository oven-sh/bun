function members(set: Set<number>): string { let text = ""; for (const member of set) text += member + ";"; return text; }
function firstMember(set: Set<number>): number { for (const member of set) return member; return -1; }
function values(map: Map<string, number>): number { let sum = 0; for (const value of map.values()) sum += value; return sum; }
function keys(map: Map<string, number>): string { let text = ""; for (const key of map.keys()) { text += key; if (text.length > 3) break; } return text; }
function entries(map: Map<string, number>): string { let text = ""; for (const [key, value] of map.entries()) text += key + value; return text; }
function grows(map: Map<string, number>): number { let turns = 0; for (const value of map.values()) { turns++; if (map.size < 6) map.set("n" + turns, value); } return turns; }
function cleared(map: Map<string, number>): number { let turns = 0; for (const key of map.keys()) { turns++; map.clear(); if (turns < 3) map.set(key + "x", turns); } return turns; }
function makeMap(from: number): Map<string, number> { const map = new Map<string, number>(); for (let i = 0; i < 3; i++) map.set("k" + i, from + i); return map; }
function makeSet(from: number): Set<number> { const set = new Set<number>(); for (let i = 0; i < 3; i++) set.add(from + i); return set; }
let out = ""; for (let round = 0; round < 30; round++) out = [members(makeSet(round)), firstMember(makeSet(round)), members(new Set()), values(makeMap(round)), keys(makeMap(round)), entries(makeMap(round)), grows(makeMap(round)), cleared(makeMap(round)), values(new Map())].join(" "); console.log(out);
