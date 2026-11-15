const numbers: number[] = JSON.parse("[0,1,2,3,4,5]");
function storeInTurns(list: number[], to: number, turns: number): string { let thrown = 0, stored = 0; for (let i = 0; i < turns; i++) { try { list.length = to >>> 0; stored++; } catch { thrown++; } } return stored + ":" + thrown + ":" + list.length; }
const frozen = [1, 2, 3]; Object.freeze(frozen);
const fixed = [1, 2, 3]; Object.defineProperty(fixed, "length", { writable: false });
const data = (): number[] => [1, 2, 3];
console.log(storeInTurns(frozen, numbers[3]!, 5), storeInTurns(fixed, numbers[3]!, 5), storeInTurns([1, 2, 3], numbers[3]!, 5), storeInTurns(data(), numbers[3]!, 5), storeInTurns(data(), numbers[1]!, 5), data().join());
