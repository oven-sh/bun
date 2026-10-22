// An array is made shorter, longer, sparse, of another kind of elements or frozen by a call in the middle of a loop over it.
type Change = (list: number[], at: number) => void;
const changes: [string, Change][] = [
  ["nothing", () => {}],
  ["length = 0", list => { list.length = 0; }],
  ["length = 2", list => { list.length = 2; }],
  ["pop", list => { list.pop(); }],
  ["pop twice", list => { list.pop(); list.pop(); }],
  ["shift", list => { list.shift(); }],
  ["splice the rest", (list, at) => { list.splice(at + 1); }],
  ["splice the head", list => { list.splice(0, 3); }],
  ["push", (list, at) => { if (at < 40) list.push(at + 100); }],
  ["push many", (list, at) => { if (at === 2) for (let i = 0; i < 200; i++) list.push(i); }],
  ["unshift", (list, at) => { if (at < 5) list.unshift(-1); }],
  ["delete the next", (list, at) => { delete list[at + 1]; }],
  ["a fraction", (list, at) => { if (at < 40) list[at + 1] = 0.5; }],
  ["far away", (list, at) => { if (at === 1) list[5000] = 7; }],
  ["very far away", (list, at) => { if (at === 1) list[200000] = 7; }],
  ["shorter, then longer", list => { list.length = 1; list.length = 12; }],
  ["fill", list => { list.fill(3); }],
  ["reverse", list => { list.reverse(); }],
  ["sort", list => { list.sort((a, b) => b - a); }],
  ["copyWithin", list => { list.copyWithin(0, 3); }],
  ["frozen", (list, at) => { if (at === 3) Object.freeze(list); }],
];
function fresh(kind: number): number[] {
  if (kind === 0) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  if (kind === 1) return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5];
  if (kind === 2) { const list: number[] = []; for (let i = 0; i < 10; i++) list.push(i * 3); return list; }
  const list = new Array<number>(10); for (let i = 0; i < 10; i += 2) list[i] = i; return list;
}
function show(value: unknown): string {
  if (Array.isArray(value)) return value.length > 24 ? "[" + value.length + ": " + value.slice(0, 12).map(String).join(",") + "]" : "[" + Array.from(value, String).join(",") + "]";
  return String(value);
}
type Loop = (list: number[], change: Change) => unknown;
const loops: [string, Loop][] = [
  ["for to length", (list, change) => { let sum = 0; for (let i = 0; i < list.length && i < 300; i++) { sum += list[i]; change(list, i); } return sum; }],
  ["for to a kept length", (list, change) => { let sum = ""; const n = list.length; for (let i = 0; i < n; i++) { sum += list[i] + ";"; change(list, i); } return sum; }],
  ["for down", (list, change) => { let sum = ""; for (let i = list.length - 1; i >= 0; i--) { change(list, i); sum += list[i] + ";"; } return sum; }],
  ["for of", (list, change) => { let sum = "", i = 0; for (const x of list) { sum += x + ";"; change(list, i++); if (i > 300) break; } return sum; }],
  ["stores", (list, change) => { const n = list.length; for (let i = 0; i < n; i++) { change(list, i); try { list[i] = i * 2; } catch { return "refused at " + i; } } return list; }],
  ["forEach", (list, change) => { let sum = ""; list.forEach((x, i) => { sum += x + ";"; change(list, i); }); return sum; }],
  ["map", (list, change) => list.map((x, i) => { change(list, i); return x * 2; })],
  ["filter", (list, change) => list.filter((x, i) => { change(list, i); return x > 2; })],
  ["some", (list, change) => list.some((x, i) => { change(list, i); return x > 1000; })],
  ["every", (list, change) => list.every((x, i) => { change(list, i); return x !== 9999; })],
  ["find", (list, change) => list.find((x, i) => { change(list, i); return x === 9; })],
  ["findIndex", (list, change) => list.findIndex((x, i) => { change(list, i); return x === undefined; })],
  ["findLast", (list, change) => list.findLast((x, i) => { change(list, i); return x === 1; })],
  ["reduce", (list, change) => list.reduce((sum, x, i) => { change(list, i); return sum + x; }, 0)],
  ["reduceRight", (list, change) => list.reduceRight((sum, x, i) => { change(list, i); return sum + ";" + x; }, "")],
  ["flatMap", (list, change) => list.flatMap((x, i) => { change(list, i); return [x, x]; })],
  ["sort", (list, change) => { let i = 0; return list.sort((a, b) => { if (i < 3) change(list, i++); return a - b; }).length >= 0; }],
  ["toSorted", (list, change) => { let i = 0; return list.toSorted((a, b) => { if (i < 3) change(list, i++); return a - b; }).length; }],
  ["from", (list, change) => Array.from(list, (x, i) => { change(list, i); return x; })],
  ["join of objects", (list, change) => { let i = 0; const held: unknown[] = list.map(x => ({ toString() { change(list, i++); return String(x); } })); return held.join(); }],
  ["indexOf from valueOf", (list, change) => list.indexOf(9, { valueOf() { change(list, 0); return 0; } } as any)],
  ["slice to valueOf", (list, change) => list.slice(0, { valueOf() { change(list, 0); return 8; } } as any)],
  ["fill to valueOf", (list, change) => { try { return list.fill(1, 0, { valueOf() { change(list, 0); return 8; } } as any); } catch (e) { return (e as Error).constructor.name; } }],
  ["splice with valueOf", (list, change) => { try { return list.splice(1, { valueOf() { change(list, 0); return 4; } } as any); } catch (e) { return (e as Error).constructor.name; } }],
  ["spread of a call", (list, change) => Math.max(...list, ...(change(list, 0), list))],
  ["destructuring", (list, change) => { const [a, b, c] = list; change(list, 0); const [d, e, ...rest] = list; return [a, b, c, d, e, rest.length]; }],
];
for (const [nameOfLoop, loop] of loops) {
  for (const [nameOfChange, change] of changes) {
    let line = nameOfLoop + " | " + nameOfChange + ":";
    for (let kind = 0; kind < 4; kind++) {
      const list = fresh(kind);
      let outcome: string;
      try { outcome = show(loop(list, change)); } catch (e) { outcome = (e as Error).constructor.name; }
      line += " " + outcome + " -> " + show(list);
    }
    console.log(line);
  }
}
