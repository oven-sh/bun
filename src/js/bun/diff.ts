// Hardcoded module "diff"
//
// SIMD-optimized Myers diff engine for text comparison.
// Designed for AI coding assistants like Claude Code.

/** A single edit operation */
export interface Edit {
  type: "equal" | "insert" | "delete";
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

/** Statistics about the diff */
export interface DiffStats {
  linesAdded: number;
  linesDeleted: number;
  hunks: number;
}

/** Result of a diff operation */
export interface DiffResult {
  edits: Edit[];
  stats: DiffStats;
}

// Import native diff binding from Zig
const { diff: nativeDiff } = $zig("bun_diff_binding.zig", "generate") as {
  diff: (a: string, b: string) => DiffResult;
};

/**
 * Compute the difference between two strings.
 *
 * Uses the Myers O(ND) diff algorithm with SIMD-accelerated comparison.
 *
 * @example
 * ```ts
 * import { diff } from "bun:diff";
 *
 * const result = diff("hello\nworld\n", "hello\nearth\n");
 * console.log(result.stats); // { linesAdded: 1, linesDeleted: 1, hunks: 1 }
 * ```
 *
 * @param a - The original string
 * @param b - The modified string
 * @returns The diff result containing edits and statistics
 */
function diff(a: string, b: string): DiffResult {
  if (typeof a !== "string" || typeof b !== "string") {
    throw new TypeError("diff() arguments must be strings");
  }
  return nativeDiff(a, b);
}

export default { diff };
