export function firstOf(map: Map<number, number>, turns: number): string { let seen = ""; for (let at = 0; at < turns; at++) seen += map.get(0) + ","; return seen; }
export function lastOf(list: number[], turns: number): string { let seen = ""; for (let at = 0; at < turns; at++) seen += list.indexOf(2) + ","; return seen; }
export function holds(set: Set<number>, turns: number): string { let seen = ""; for (let at = 0; at < turns; at++) seen += set.has(1) + ","; return seen; }
export function total(set: Set<number>): string { let seen = ""; for (const member of set) seen += member + ","; return seen; }
