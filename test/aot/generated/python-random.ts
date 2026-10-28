// The random numbers of Python's `random.Random(seed)`, for the generators here that were first written in Python: a seed names the
// same program in both, so a port can be compared with its original and a seed that was written down once still means something.
export class Random {
  #state = new Uint32Array(624);
  #index = 624;

  /** `seed` is an integer from 0 up to 2 ** 53. */
  constructor(seed: number) {
    const key = seed < 2 ** 32 ? [seed >>> 0] : [seed >>> 0, Math.floor(seed / 2 ** 32) >>> 0];
    const state = this.#state;
    state[0] = 19650218;
    for (let i = 1; i < 624; i++) state[i] = (Math.imul(1812433253, state[i - 1] ^ (state[i - 1] >>> 30)) + i) >>> 0;
    let i = 1;
    let j = 0;
    for (let k = Math.max(624, key.length); k > 0; k--) {
      state[i] = ((state[i] ^ Math.imul(state[i - 1] ^ (state[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
      if (++i >= 624) (state[0] = state[623]), (i = 1);
      if (++j >= key.length) j = 0;
    }
    for (let k = 623; k > 0; k--) {
      state[i] = ((state[i] ^ Math.imul(state[i - 1] ^ (state[i - 1] >>> 30), 1566083941)) - i) >>> 0;
      if (++i >= 624) (state[0] = state[623]), (i = 1);
    }
    state[0] = 0x80000000;
  }

  #word(): number {
    const state = this.#state;
    if (this.#index >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = (state[k] & 0x80000000) | (state[(k + 1) % 624] & 0x7fffffff);
        state[k] = state[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.#index = 0;
    }
    let y = state[this.#index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** From 0 up to 1. */
  random(): number {
    const a = this.#word() >>> 5;
    const b = this.#word() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** An integer from 0 up to `n`, which is at most 2 ** 32. */
  below(n: number): number {
    if (n === 0) return 0;
    const bits = 32 - Math.clz32(n) + (n >= 2 ** 32 ? 33 : 0);
    for (;;) {
      const r = bits > 32 ? this.#word() + (this.#word() >>> 31) * 2 ** 32 : this.#word() >>> (32 - bits);
      if (r < n) return r;
    }
  }

  /** `randrange(stop)` and `randrange(start, stop)`. */
  randrange(start: number, stop?: number): number {
    return stop === undefined ? this.below(start) : start + this.below(stop - start);
  }

  /** Both ends are included. */
  randint(first: number, last: number): number {
    return first + this.below(last - first + 1);
  }

  choice<T>(list: readonly T[]): T {
    return list[this.below(list.length)];
  }

  shuffle<T>(list: T[]): void {
    for (let i = list.length - 1; i > 0; i--) {
      const j = this.below(i + 1);
      [list[i], list[j]] = [list[j], list[i]];
    }
  }

  sample<T>(list: readonly T[], count: number): T[] {
    const n = list.length;
    const result: T[] = [];
    let setSize = 21;
    if (count > 5) setSize += 4 ** Math.ceil(Math.log(count * 3) / Math.log(4));
    if (n <= setSize) {
      const pool = [...list];
      for (let i = 0; i < count; i++) {
        const j = this.below(n - i);
        result.push(pool[j]);
        pool[j] = pool[n - i - 1];
      }
    } else {
      const chosen = new Set<number>();
      for (let i = 0; i < count; i++) {
        let j = this.below(n);
        while (chosen.has(j)) j = this.below(n);
        chosen.add(j);
        result.push(list[j]);
      }
    }
    return result;
  }

  uniform(from: number, to: number): number {
    return from + (to - from) * this.random();
  }
}
