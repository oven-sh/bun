/**
 * Shared plumbing for the seeded differential fuzz tests (Bun.JSONC.parse vs
 * JSON.parse, node:path vs node, Bun.Glob vs picomatch, Bun.build sourcemaps vs
 * the `source-map` decoder, the transpiler printer vs acorn).
 *
 * Every oracle is deterministic for a seed, runs a few hundred iterations by
 * default, and puts the seed and iteration into each failure message, so a CI
 * failure replays locally and a long soak is one environment variable away:
 *
 *     BUN_PATH_FUZZ_SEED=1234 bun bd test path-differential-fuzz
 *     BUN_PATH_FUZZ_ITERS=20000 bun bd test path-differential-fuzz
 */

/** mulberry32: a 32-bit seed is enough state, and it is fast under a debug JSC. */
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
  /** Appended to the test name so a failure line shows the seed it ran with. */
  readonly label: string;
  /** Replay instructions for a failure message. */
  repro(iteration: number): string;
}

/**
 * Reads `${prefix}_SEED` and `${prefix}_ITERS` (for example `BUN_GLOB_FUZZ_SEED`
 * and `BUN_GLOB_FUZZ_ITERS`), falling back to the given defaults.
 */
export function fuzzEnv(prefix: string, defaultSeed: number, defaultIters: number): Fuzz {
  const seedName = `${prefix}_SEED`;
  const seed = envSeed(seedName, defaultSeed);
  const iters = envIters(`${prefix}_ITERS`, defaultIters);
  return {
    seed,
    iters,
    label: `(seed=${seed}, iters=${iters})`,
    repro(iteration: number): string {
      return `seed=${seed} iteration=${iteration} (replay with ${seedName}=${seed})`;
    },
  };
}
