(globalThis as any).shelf = { make: () => new Set([1, 2, 3]).values(), makeOfMap: () => new Map([["a", 1]]).values(), makeOfList: () => [1, 2, 3].values() };
const shelf: any = (globalThis as any).shelf;
function seen(items: any): string { try { let text = ""; for (const item of items) text += String(item) + ";"; return text; } catch (error) { return (error as Error).constructor.name; } }
const nextOfMaps = Object.getPrototypeOf(new Map().values()).next;
const nextOfSets = Object.getPrototypeOf(new Set().values()).next;
const nextOfLists = Object.getPrototypeOf([].values()).next;
let out = "";
for (let round = 0; round < 3; round++) {
  const own = shelf.make(); let left = 2; own.next = () => (left-- > 0 ? { done: false, value: "own" } : { done: true, value: undefined }); out += seen(own) + "|";
  const crossed = shelf.make(); crossed.next = nextOfMaps; out += seen(crossed) + "|";
  const crossedMap = shelf.makeOfMap(); crossedMap.next = nextOfSets; out += seen(crossedMap) + "|";
  const crossedList = shelf.makeOfList(); crossedList.next = nextOfSets; out += seen(crossedList) + "|";
  const same = shelf.make(); same.next = nextOfSets; out += seen(same) + "|";
  const above = shelf.makeOfList(); Object.setPrototypeOf(above, { next: () => ({ done: true }), [Symbol.iterator]() { return this; } }); out += seen(above) + "|";
  const plain = { next: nextOfLists, [Symbol.iterator]() { return this; } }; out += seen(plain) + "|";
  const number = { next: 3, [Symbol.iterator]() { return this; } }; out += seen(number) + "|";
}
console.log(out);
