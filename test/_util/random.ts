type UnitInterval = number & { readonly __brand: 'UnitInterval' };

function isUnitInterval(n: number): n is UnitInterval {
  return n >= 0 && n < 1;
}

function asUnitInterval(n: number): UnitInterval {
  if (!isUnitInterval(n)) {
    throw new Error(`Expected number in [0, 1), got ${n}`);
  }
  return n as UnitInterval;
}

export type RandomEngine = () => UnitInterval;

/**
 * Return a seed based on the current month and year.
 *
 * Tests which depend on randomness should be stable and reproducible and without a seed that is impossible.
 * This function provides a seed that changes monthly, allowing tests to vary over time while remaining stable
 * within a given month.
 *
 * @returns A seed value based on the current month and year.
 */
export function currentMonthSeed(): number {
  const now = new Date();
  return now.getFullYear() * 100 + (now.getMonth() + 1);
}

/**
 * Seedable PRNG implementation using Mulberry32 algorithm.
 *
 * @param seed The seed value.
 * @returns A function that generates a pseudo-random value [0, 1). Subsequent invokations will produce a sequence of
 *          pseudo-random values in the same range.
 */
export function mulberry32Prng(seed: number): RandomEngine {
  let state = seed;
  return () => {
    let t = state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return asUnitInterval(((t ^ t >>> 14) >>> 0) / 4294967296);
  }
}

/** Generate a random integer between min (inclusive) and max (exclusive). */
export function range(randomEngine: RandomEngine, min: number, max: number): number {
  return Math.floor(randomEngine() * (max - min)) + min;
}

/** Simulate a coin flip using the given random engine. */
export function coinFlip(randomEngine: RandomEngine): boolean {
  return randomEngine() < 0.5;
}

/**
 * Select `n` random elements from an array, ensuring that the resulting array contains at least one element from the
 * given list.
 *
 * `n` must be greater than or equal to the length of `universe`.
 */
export function selectNUniversal<T>(universe: T[], count: number, randomEngine: RandomEngine): T[] {
  if (count < universe.length) {
    throw new Error("Count must be >= universe length");
  }

  // Inefficient claude implementation.
  const remaining = count - universe.length;
  const extras = Array.from({ length: remaining }, () =>
    universe[Math.floor(randomEngine() * universe.length)]
  );

  return shuffle([...universe, ...extras], randomEngine);
}

/**
 * Shuffle an array using the Fisher-Yates algorithm and a custom random engine.
 */
export function shuffle<T>(array: T[], randomEngine: () => number): T[] {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(randomEngine() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/** Geneerates a random UTF-8 string */
export function utf8String(randomEngine: RandomEngine, length: number): string {
  // TODO(markovejnovic): This is a sucky Claude-generated implementation. Improve it.

  let result = '';
  for (let i = 0; i < length; i++) {
    const rand = randomEngine();

    // Distribute across different Unicode ranges
    // 80% ASCII, 15% Latin-1 Supplement, 5% other BMP
    if (rand < 0.8) {
      // ASCII printable: 0x20-0x7E
      result += String.fromCharCode(range(randomEngine, 0x20, 0x7F));
    } else if (rand < 0.95) {
      // Latin-1 Supplement: 0xA0-0xFF
      result += String.fromCharCode(range(randomEngine, 0xA0, 0x100));
    } else {
      // Basic Multilingual Plane: 0x0100-0xD7FF (excludes surrogates)
      result += String.fromCharCode(range(randomEngine, 0x0100, 0xD800));
    }
  }

  return result;
}

/** Utilities random filesystem operations. */
export namespace FileSystem {
  /** Generate a fake file/directory name for the given platform. */
  export function fakeInodeName(randomEngine: RandomEngine, platform: "posix" | "windows"): string {
    switch (platform) {
      case "posix": {
        const NAME_MAX = 255; // TODO(markovejnovic): Technically not true, since it really depends on the FS.
        const len = range(randomEngine, 1, NAME_MAX);
        return utf8String(randomEngine, len);
      }
      case "windows": {
        throw new Error("Not implemented.");
      }
    }
  }

  /** Generate a filesystem path -- does not need to exist on disk. */
  export function fakeAbsPath(
    randomEngine: RandomEngine,
    platform: "posix" | "windows",
    ext: string | undefined = undefined,
  ): string {
    const generatePosix = () => {
      // TODO(markovejnovic): Claude-generated implementation, improve.
      const MAX_PATH = 4096;
      const parts: string[] = [];
      let currentLength = 1; // Start with leading "/"

      // Add extension length if provided
      const extToAdd = ext ? (ext.startsWith('.') ? ext : '.' + ext) : '';

      while (currentLength < MAX_PATH - extToAdd.length - 1) {
        const part = fakeInodeName(randomEngine, platform);
        const newLength = currentLength + part.length + 1; // +1 for "/"

        // Would this exceed our limit?
        if (newLength + extToAdd.length > MAX_PATH) {
          break;
        }

        parts.push(part);
        currentLength = newLength;

        // Randomly stop to create varying depths (30% chance after at least 2 components)
        if (parts.length >= 2 && randomEngine() < 0.3) {
          break;
        }
      }

      // Ensure we have at least one component
      if (parts.length === 0) {
        parts.push(fakeInodeName(randomEngine, platform).slice(0, 10));
      }

      // Add extension to last component
      if (extToAdd) {
        parts[parts.length - 1] += extToAdd;
      }

      return '/' + parts.join('/');
    };

    const generateWindows = () => {
      throw new Error("Not implemented.");
    };

    switch (platform) {
      case "posix": return generatePosix();
      case "windows": return generateWindows();
    }
  }
}

/** Utilities for working with network operations. */
export namespace Net {
  /** Generate a fake IP address (IPv4). */
  export function fakeIpv4(randomEngine: RandomEngine): string {
    return Array.from({ length: 4 }, () => range(randomEngine, 0, 256)).join('.');
  }

  /** Generate a fake IP address (IPv6). */
  export function fakeIpv6(randomEngine: RandomEngine): string {
    const segments = Array.from({ length: 8 }, () => range(randomEngine, 0, 0x10000).toString(16));
    return segments.join(':');
  }

  /** Generate a fake IP address (either IPv4 or IPv6). */
  export function fakeIp(randomEngine: RandomEngine): string {
    return coinFlip(randomEngine) ? fakeIpv4(randomEngine) : fakeIpv6(randomEngine);
  }

  /** Generate a fake hostname. */
  export function fakeHostname(randomEngine: RandomEngine): string {
    // TODO(markovejnovic): Claude-generated implementation, improve.
    // What the hell is this even?
    const alphanumeric = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const withHyphen = alphanumeric + '-';

    const label = (len: number) => Array.from(
      { length: len },
      (_, i) => (i === 0 || i === len - 1 ? alphanumeric : withHyphen)[
        range(randomEngine, 0, i === 0 || i === len - 1 ? alphanumeric.length : withHyphen.length)
      ]
    ).join('');

    const labels = Array.from({ length: 10 }, () => label(range(randomEngine, 1, 64)))
      .reduce((acc, l) =>
        acc.join('.').length + l.length + 1 <= 253 ? [...acc, l] : acc,
        [] as string[]
      )
      .slice(0, range(randomEngine, 1, 10));

    return labels.length > 0 ? labels.join('.') : label(range(randomEngine, 1, 64));
  }

  export function location(randomEngine: RandomEngine): string {
    return coinFlip(randomEngine) ? fakeIp(randomEngine) : fakeHostname(randomEngine);
  }

  export function port(randomEngine: RandomEngine, min = 1, max = 65536): number {
    return range(randomEngine, min, max);
  }
}
