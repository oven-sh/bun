import vm from "node:vm"; const m = new Map<unknown, unknown>([[1, "a"], [2, "b"]]), s = new Set<unknown>([1, 2]), said: string[] = [];
function all(values: any): string { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; try { return [0, ...values].join(""); } catch (error) { return (error as Error).name; } }
const shared: any = m.values(); said.push([0, ...shared, ...shared].join(""));
const under: any = s.values(); Object.setPrototypeOf(under, { next() { return { done: true, value: undefined }; }, [Symbol.iterator]() { return this; } }); said.push(all(under));
const bare: any = m.keys(); Object.setPrototypeOf(bare, null); said.push(all(bare));
const far: any = vm.runInContext("new Map([[1, 'x'], [2, 'y']])", vm.createContext({})); said.push(all(far.values()), all(Map.prototype.values.call(far)), all(far.keys()));
let reads = 0; const asked: any = s.keys(); Object.defineProperty(asked, "next", { get() { reads++; return () => ({ done: true, value: undefined }); } }); said.push(all(asked), String(reads));
const tagged: any = m.values(); tagged.tag = 1; said.push(all(tagged), String(tagged.next().done), all(m.entries()));
console.log(`SAID ${said.join(" ")}`); export {};
