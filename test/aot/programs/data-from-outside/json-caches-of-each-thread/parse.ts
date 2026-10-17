const collect = (): void => (globalThis as unknown as { Bun: { gc(force: boolean): void } }).Bun.gc(true);

export function describe(label: string): string[] {
  const lines: string[] = [];
  for (const round of [1, 2, 3]) {
    const rows: unknown[] = [];
    for (const length of [0, 1, 26, 27, 28, 255, 256, 257]) {
      const text = "k".repeat(length);
      const other = length ? "k".repeat(length - 1) + "j" : "j";
      const source = `[{"name":"${text}","${text}x":1,"same":"same"},{"name":"${other}","${other}x":2,"same":"same"},{"name":"${text}","${text}x":3,"same":"same"}]`;
      const parsed = JSON.parse(source) as Record<string, unknown>[];
      rows.push(parsed.map(row => [(row.name as string).length, (row.name as string).at(-1) ?? "", Object.keys(row).map(key => key.length + key.slice(-2)).join(), row.same].join(":")).join(" "));
      if (JSON.stringify(parsed) !== source) rows.push("not the same text at " + length);
    }
    lines.push(label + " round " + round + ": " + rows.join(" | "));
    collect();
  }
  return lines;
}
