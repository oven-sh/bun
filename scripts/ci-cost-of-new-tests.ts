const fewestToJudgeBy = 3;

// The mean of the files directly beside it, not the median: shards are balanced by sums.
export function costOfNewTests(durations: Record<string, number>): (path: string) => number {
  const folders = new Map<string, { sum: number; count: number }>();
  for (const [path, ms] of Object.entries(durations)) {
    const folder = path.slice(0, Math.max(path.lastIndexOf("/"), 0));
    const beside = folders.get(folder) ?? { sum: 0, count: 0 };
    beside.sum += ms;
    beside.count++;
    folders.set(folder, beside);
  }
  const all = Object.values(durations).sort((a, b) => a - b);
  const median = all[Math.floor(all.length / 2)] ?? 100;
  return path => {
    let folder = path.replaceAll("\\", "/");
    while (folder.includes("/")) {
      folder = folder.slice(0, folder.lastIndexOf("/"));
      const beside = folders.get(folder);
      if (beside && beside.count >= fewestToJudgeBy) return beside.sum / beside.count;
    }
    return median;
  };
}
