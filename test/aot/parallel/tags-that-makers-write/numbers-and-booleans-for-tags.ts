type Node = { kind: 0; value: number } | { kind: 1; left: number } | { kind: true; flag: number } | { kind: false; other: number };
function read(x: Node): unknown { if (x.kind === 0) return "v" + x.value; if (x.kind === 1) return "l" + x.left; if (x.kind === true) return "f" + x.flag; return "o" + (x as any).other; }
function show(run: () => unknown): string { try { return String(run()); } catch (error) { return (error as Error).constructor.name; } }
const made: unknown[] = [{ kind: 0, value: 1 }, { kind: 1, left: 2 }, { kind: true, flag: 3 }, { kind: false, other: 4 }, { kind: -0, value: 5 }, { kind: 0.0, value: 6 }, { kind: 1.5, left: 7 }, { kind: NaN, value: 8 }, { kind: 0n, value: 9 }, { kind: "0", value: 10 }, { kind: 2 ** 31, left: 11 }, { kind: 2 ** 53, left: 12 }, { kind: -1, left: 13 }];
for (let round = 0; round < 3; round++) console.log(made.map(x => show(() => read(x as Node))).join(" "));
