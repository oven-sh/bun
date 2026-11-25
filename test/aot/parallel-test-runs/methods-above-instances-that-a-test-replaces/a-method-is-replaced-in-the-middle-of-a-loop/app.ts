type Then = () => void;
export function pushes(list: number[], turns: number, atTurn: number, then: Then): string { let seen = ""; for (let at = 0; at < turns; at++) { if (at === atTurn) then(); seen += list.push(at) + ","; } return seen + list.length; }
export function pops(list: number[], turns: number, atTurn: number, then: Then): string { let seen = ""; for (let at = 0; at < turns; at++) { if (at === atTurn) then(); seen += list.pop() + ","; } return seen + list.length; }
export function looksFor(list: number[], turns: number, atTurn: number, then: Then): string { let seen = ""; for (let at = 0; at < turns; at++) { if (at === atTurn) then(); seen += list.includes(at) + "" + list.indexOf(at) + ","; } return seen; }
export function gets(map: Map<number, number>, turns: number, atTurn: number, then: Then): string { let seen = ""; for (let at = 0; at < turns; at++) { if (at === atTurn) then(); seen += map.get(at) + "" + map.has(at) + ","; } return seen; }
export function sets(map: Map<number, number>, turns: number, atTurn: number, then: Then): string { let seen = ""; for (let at = 0; at < turns; at++) { if (at === atTurn) then(); map.set(at, at * 2); seen += map.size + ","; } return seen; }
export function adds(set: Set<number>, turns: number, atTurn: number, then: Then): string { let seen = ""; for (let at = 0; at < turns; at++) { if (at === atTurn) then(); set.add(at); seen += set.has(at) + "" + set.size + ","; } return seen; }
export function codes(text: string, turns: number, atTurn: number, then: Then): string { let seen = ""; for (let at = 0; at < turns; at++) { if (at === atTurn) then(); seen += text.charCodeAt(at) + "" + text.startsWith("a") + ","; } return seen; }
export function walks(set: Set<number>, map: Map<number, number>, turns: number, atTurn: number, then: Then): string {
  let seen = "";
  for (let at = 0; at < turns; at++) {
    if (at === atTurn) then();
    for (const member of set) seen += member;
    for (const [key, value] of map) seen += key + value;
    for (const value of map.values()) seen += value;
    for (const key of set.keys()) seen += key;
    seen += ",";
  }
  return seen;
}
