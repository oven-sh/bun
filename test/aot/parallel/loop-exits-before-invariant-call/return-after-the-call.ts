// The loop returns after the call, so every loop that begins an iteration makes it, and it is hoisted.
// COUNT: operation:operationAOTStringToLowerCase <= 3
const list: string[] = JSON.parse('["a","b","c","d","e","query","f"]');
function find(list: string[], q: string): number { for (let i = 0; i < list.length; i++) { if (list[i] === q.toLowerCase()) return i; } return -1; }
(globalThis as any).kept = find;
const q: string = JSON.parse('"QUERY"');
for (let round = 0; round < 3; round++) console.log(find(list, q));
