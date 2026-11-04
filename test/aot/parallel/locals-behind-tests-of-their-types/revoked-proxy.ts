function probe(value: string | number[]): number { if (Array.isArray(value)) return value.length; return -1; }
(globalThis as any).probe = probe;
const { proxy, revoke } = Proxy.revocable([1, 2, 3], {});
console.log(probe(proxy));
revoke();
for (let round = 0; round < 3; round++) { try { console.log(probe(proxy)); } catch (error) { console.log((error as Error).constructor.name, (error as Error).message); } }
