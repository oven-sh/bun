export interface Growth {
  instructions?: number;
  peakBytes?: number;
  counts?: Record<string, number>;
}

const lowest = (recorded: number | undefined, measured: number | undefined) =>
  recorded === undefined || measured === undefined ? (measured ?? recorded) : Math.min(recorded, measured);

/**
 * What `AOT_BUDGETS=lower` writes as a shape's growth. `overTheBound` holds only what this run measured above the default bound.
 *
 * A recorded growth may come from another platform: macOS judges memory that Linux does not. A run that stays under the
 * default bound, or does not judge that cost at all, says nothing about it, so the record stays.
 */
export function lowerRecordedGrowth(recorded: Growth | undefined, overTheBound: Growth): Growth | undefined {
  const names = [...new Set([...Object.keys(recorded?.counts ?? {}), ...Object.keys(overTheBound.counts ?? {})])];
  const growth: Growth = {
    instructions: lowest(recorded?.instructions, overTheBound.instructions),
    peakBytes: lowest(recorded?.peakBytes, overTheBound.peakBytes),
    counts: names.length
      ? Object.fromEntries(names.map(name => [name, lowest(recorded?.counts?.[name], overTheBound.counts?.[name])!]))
      : undefined,
  };
  return Object.values(growth).every(times => times === undefined) ? undefined : growth;
}
