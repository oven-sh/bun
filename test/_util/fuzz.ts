/**
 * Shared plumbing for the seeded differential fuzz tests (Bun.JSONC.parse vs
 * JSON.parse, node:path vs node, Bun.Glob vs picomatch, Bun.build source maps
 * vs the `source-map` decoder, the transpiler vs acorn and itself).
 *
 * Every oracle generates its cases from one seeded generator, so case N is the
 * same however many cases a run asks for, and every failure message carries the
 * seed and the case number. A CI failure therefore replays locally with the two
 * environment variables it prints, and a long soak is one variable away (plus
 * a test timeout to match, since the defaults are sized for a few seconds):
 *
 *     BUN_PATH_FUZZ_SEED=1234 BUN_PATH_FUZZ_ITERS=57 bun bd test path-differential-fuzz
 *     BUN_PATH_FUZZ_ITERS=20000 bun bd test path-differential-fuzz --timeout=600000
 *
 * Each oracle also pins the divergences it found on main with `test.failing`
 * next to the generator exclusion that works around them, so the fix that makes
 * a pin pass is also told which exclusion to delete.
 */
import { isDebug } from "harness";

/** mulberry32: 32 bits of state is plenty, and it stays fast under a debug JSC. */
export class Rng {
  private a: number;
  constructor(seed: number) {
    this.a = seed >>> 0;
  }
  /** Uniform in [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** Integer in [lo, hi], inclusive on both ends. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  /** `count` picks from `alphabet`, concatenated. */
  string(alphabet: readonly string[] | string, count: number): string {
    let s = "";
    for (let i = 0; i < count; i++) s += alphabet[this.int(alphabet.length)];
    return s;
  }
}

export function envSeed(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw === undefined ? fallback >>> 0 : Number(raw) >>> 0;
}

/** A positive integer from the environment, else `fallback`. */
export function envIters(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw) | 0;
  return n > 0 ? n : fallback;
}

export interface Fuzz {
  readonly seed: number;
  readonly iters: number;
  /** Appended to the test name, so a failure line shows what the run used. */
  readonly label: string;
  /** Replay instructions, for the failure message of case `iteration` (0-based). */
  repro(iteration: number): string;
}

/**
 * Reads `${prefix}_SEED` and `${prefix}_ITERS` (for example `BUN_GLOB_FUZZ_SEED`
 * and `BUN_GLOB_FUZZ_ITERS`). The default iteration counts are sized for a few
 * seconds of test time; a debug build's JavaScriptCore runs the generators and
 * the reference implementations far slower, so it gets its own, smaller default.
 */
export function fuzzEnv(prefix: string, defaultSeed: number, defaultIters: { release: number; debug: number }): Fuzz {
  const seedName = `${prefix}_SEED`;
  const itersName = `${prefix}_ITERS`;
  const seed = envSeed(seedName, defaultSeed);
  const iters = envIters(itersName, isDebug ? defaultIters.debug : defaultIters.release);
  return {
    seed,
    iters,
    label: `(seed=${seed}, iters=${iters})`,
    repro(iteration: number): string {
      return `seed=${seed} iteration=${iteration} (replay: ${seedName}=${seed} ${itersName}=${iteration + 1})`;
    },
  };
}
