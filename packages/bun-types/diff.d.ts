/**
 * SIMD-optimized Myers diff engine for Bun.
 *
 * @example
 * ```ts
 * import { diff } from 'bun:diff';
 *
 * const result = diff("hello\nworld\n", "hello\nearth\n");
 * console.log(result.stats); // { linesAdded: 1, linesDeleted: 1, hunks: 1 }
 * ```
 *
 * @module bun:diff
 */
declare module "bun:diff" {
  /**
   * Type of edit operation in a diff.
   */
  export type EditType = "equal" | "insert" | "delete";

  /**
   * Represents a single edit operation in the diff result.
   *
   * Line ranges are 0-indexed and use half-open intervals [start, end).
   */
  export interface Edit {
    /**
     * The type of edit operation.
     * - `"equal"`: Lines are unchanged
     * - `"insert"`: Lines were added in the new content
     * - `"delete"`: Lines were removed from the old content
     */
    type: EditType;

    /**
     * Start line index in the old content (inclusive, 0-indexed).
     */
    oldStart: number;

    /**
     * End line index in the old content (exclusive).
     */
    oldEnd: number;

    /**
     * Start line index in the new content (inclusive, 0-indexed).
     */
    newStart: number;

    /**
     * End line index in the new content (exclusive).
     */
    newEnd: number;
  }

  /**
   * Statistics about the diff result.
   */
  export interface DiffStats {
    /**
     * Number of lines added in the new content.
     */
    linesAdded: number;

    /**
     * Number of lines deleted from the old content.
     */
    linesDeleted: number;

    /**
     * Number of contiguous change regions (hunks).
     */
    hunks: number;
  }

  /**
   * Result of a diff operation.
   */
  export interface DiffResult {
    /**
     * Array of edit operations describing the differences.
     * Edits are ordered by position in the old content.
     */
    edits: Edit[];

    /**
     * Statistics about the diff.
     */
    stats: DiffStats;
  }

  /**
   * Computes the line-based diff between two strings using the Myers algorithm.
   *
   * This implementation uses SIMD acceleration for fast line comparison and
   * applies git-style heuristics (common prefix/suffix trimming, edit distance
   * limits) for optimal performance on real-world inputs.
   *
   * @param oldContent - The original content to compare from.
   * @param newContent - The new content to compare to.
   * @returns A {@link DiffResult} containing the edit operations and statistics.
   * @throws {TypeError} If either argument is not a string.
   *
   * @example
   * ```ts
   * import { diff } from 'bun:diff';
   *
   * // Simple diff
   * const result = diff("a\nb\nc\n", "a\nx\nc\n");
   * // result.edits: [
   * //   { type: "equal", oldStart: 0, oldEnd: 1, newStart: 0, newEnd: 1 },
   * //   { type: "delete", oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 1 },
   * //   { type: "insert", oldStart: 2, oldEnd: 2, newStart: 1, newEnd: 2 },
   * //   { type: "equal", oldStart: 2, oldEnd: 3, newStart: 2, newEnd: 3 }
   * // ]
   *
   * // Check if files are identical
   * const same = diff(fileA, fileB);
   * if (same.stats.linesAdded === 0 && same.stats.linesDeleted === 0) {
   *   console.log("Files are identical");
   * }
   * ```
   */
  export function diff(oldContent: string, newContent: string): DiffResult;
}
