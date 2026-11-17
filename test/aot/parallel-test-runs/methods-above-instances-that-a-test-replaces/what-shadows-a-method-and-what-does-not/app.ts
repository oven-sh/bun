export function firstOf(map: Map<number, number>, turns: number): string { let seen = ""; for (let at = 0; at < turns; at++) seen += map.get(0) + ","; return seen; }
export function placeOf(list: number[], turns: number): string { let seen = ""; for (let at = 0; at < turns; at++) seen += list.indexOf(2) + ","; return seen; }
export function owns(list: number[], turns: number): string { let seen = ""; for (let at = 0; at < turns; at++) seen += list.hasOwnProperty(0) + "" + list.toString() + ","; return seen; }
export function ownsInMap(map: Map<number, number>, turns: number): string { let seen = ""; for (let at = 0; at < turns; at++) seen += map.hasOwnProperty("x") + "" + map.toString() + ","; return seen; }
export function lengthOfView(view: Uint8Array, turns: number): string { let seen = ""; for (let at = 0; at < turns; at++) seen += view.length + "" + view.indexOf(2) + ","; return seen; }
