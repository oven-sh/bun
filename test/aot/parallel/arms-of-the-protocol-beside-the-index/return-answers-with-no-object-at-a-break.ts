const log: string[] = [];
function counted(values: number[], more: Record<string, unknown> = {}): number[] {
  let at = 0;
  const iterator: any = { next() { log.push("next"); return at < values.length ? { done: false, value: values[at++] } : { done: true, value: 99 }; }, return() { log.push("return"); return {}; } };
  Object.defineProperties(iterator, Object.getOwnPropertyDescriptors(more));
  return { [Symbol.iterator]() { log.push("open"); return iterator; } } as any;
}
function lists(round: number): number[] { return [round, round + 1, round + 2]; }
function flush(): string { const text = log.join(); log.length = 0; return text; }
function leaves(list: number[]): string { try { for (const item of list) if (item === 5) break; return "left"; } catch (error) { return (error as Error).constructor.name; } }
let out = ""; for (let round = 0; round < 30; round++) { const kind = round % 6;
  const list = kind === 3 ? counted([1, 5], { return() { log.push("return"); return 1; } }) : kind === 4 ? counted([1, 5], { return: undefined }) : kind === 5 ? counted([1, 5], { return: null }) : [1, 5];
  out = leaves(list) + " " + flush(); if (round >= 24) console.log(out); }
