type Then = () => void;
export function sizesOfMap(map: Map<number, number>, turns: number, atTurn: number, then: Then): string { let said = ""; for (let turn = 0; turn < turns; turn++) { if (turn === atTurn) then(); said += map.size + ","; } return said; }
export function sizesOfSet(set: Set<number>, turns: number, atTurn: number, then: Then): string { let said = ""; for (let turn = 0; turn < turns; turn++) { if (turn === atTurn) then(); said += set.size + ","; } return said; }
export function grows(map: Map<number, number>, turns: number): string { let said = ""; for (let turn = 0; turn < turns; turn++) { map.set(turn + 10, turn); said += map.size + ","; } return said; }
