// A seeded generator of random numbers: the same seed gives the same program on every machine and every version of Bun.
export class Random {
  #state: number;

  constructor(seed: number) {
    this.#state = (Math.floor(seed / 4294967296) * 0x85ebca6b) ^ (seed >>> 0);
    for (let i = 0; i < 4; i++) this.next();
  }

  /** An integer in [0, 2**32). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.#state ^ (this.#state >>> 15), 1 | this.#state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** An integer in [0, limit). */
  below(limit: number): number {
    return this.next() % limit;
  }

  /** An integer in [low, high]. */
  between(low: number, high: number): number {
    return low + this.below(high - low + 1);
  }

  chance(probability: number): boolean {
    return this.next() < probability * 4294967296;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.below(items.length)];
  }

  /** Picks by weight: `weighted([[3, "often"], [1, "seldom"]])`. */
  weighted<T>(items: readonly (readonly [number, T])[]): T {
    let left = this.below(items.reduce((sum, [weight]) => sum + weight, 0));
    for (const [weight, item] of items) if ((left -= weight) < 0) return item;
    return items[items.length - 1][1];
  }

  shuffled<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.below(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /** `count` different items, in random order; all of them if there are fewer. */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffled(items).slice(0, count);
  }
}
