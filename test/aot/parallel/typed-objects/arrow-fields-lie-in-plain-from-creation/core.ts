import { probe, keep, fail, choose } from "./helpers.js";

export class BehindCode {
  key: string = `${Math.round(Math.random() * 0) + 7}`;
  listeners = new Set<number>();
  table = new Map<string, number>();
  limit: number = choose(undefined) ?? 5;
  mode: string = choose("fast") ? "fast" : "slow";
  base = 1;
  add = (value: number): number => this.base + value;
  twice = (): number => this.add(this.base) * 2;
  self = (): BehindCode => this;
  waits = async (): Promise<number> => this.base + 3;
  free = (value: number): number => value + 1;
  last = (): string => this.key + this.mode + this.limit;
  constructor(base: number) {
    this.base = base;
    this.listeners.add(this.add(1));
  }
}

export class ReadsAhead {
  value = 2;
  first = (): number => this.value;
  early: string = typeof (this as unknown as { later: unknown }).later + " " + typeof this.first;
  later = (): number => this.value + 1;
}

export class ShownInTheMiddle {
  value = 3;
  before = (): number => this.value;
  seen: string = probe(this);
  after = (): number => this.value + 1;
}

export class AsksItsHeir {
  value = 4;
  before = (): number => this.value;
  answer: string = (this as unknown as { fromHeir: string }).fromHeir;
  after = (): number => this.value + 1;
}

export class StoresSometimes {
  value = 5;
  run?: () => number = undefined;
  always = (): number => this.value;
  constructor(stores: boolean) {
    if (stores) this.run = () => this.value + 100;
  }
}

export class ReturnsEarly {
  value = 6;
  late: undefined | (() => number) = undefined;
  other: undefined | (() => number) = undefined;
  constructor(stops: boolean) {
    this.other = () => this.value + 1;
    if (stops) return;
    this.late = () => this.value + 2;
  }
}

export class StoresTwice {
  value = 7;
  run = (): number => this.value;
  constructor(again: boolean) {
    this.run = () => this.value + 10;
    if (again) this.run = () => this.value + 20;
  }
}

export class StoresInALoop {
  value = 8;
  run: undefined | (() => number) = undefined;
  seen: unknown[] = [];
  constructor(turns: number) {
    for (let i = 0; i < turns; ++i) {
      this.run = () => this.value + 1;
      this.seen.push(this.run);
    }
  }
}

export class OverwritesWithAValue {
  value = 9;
  run: unknown = () => this.value;
  constructor(overwrites: boolean) {
    if (overwrites) this.run = "no function";
  }
}

export class ThrowsInTheMiddle {
  value = 10;
  before = (): number => this.value;
  kept: number = keep(this);
  between = (): number => this.value + 1;
  boom: number = fail("in the middle") ?? 0;
  after = (): number => this.value + 2;
}

export class ThrowsUnseen {
  value = 11;
  before = (): number => this.value;
  boom: number = fail("unseen") ?? 0;
  after = (): number => this.value + 2;
}

export class Catches {
  value = 12;
  first = (): number => this.value;
  caught = "";
  second: undefined | (() => number) = undefined;
  constructor(throws: boolean) {
    try {
      if (throws) fail("caught");
      this.second = () => this.value + 1;
    } catch (error) {
      this.caught = (error as Error).message + " " + typeof this.second;
    }
  }
}

export class ReturnsAnother {
  value = 13;
  run = (): number => this.value;
  constructor(other: object | undefined) {
    if (other) return other as ReturnsAnother;
  }
}

export class Base {
  value = 14;
  shared = (): number => this.value;
  replaced = (): string => "base " + this.value;
  own = (): number => this.value + 1;
}
export class Middle extends Base {
  sawShared: string = typeof this.shared + " " + this.shared();
  replaced = (): string => "middle " + this.value;
  mine = (): number => this.value + 2;
}

export class StoresItself {
  value = 15;
  me: StoresItself = this;
  run = (): number => this.value;
}

export class HandsOutAClosure {
  value = 16;
  handed: number = keep(() => typeof this.after);
  after = (): number => this.value;
}

export class CapturesMore {
  value = 17;
  both: () => number;
  one = (): number => this.value;
  constructor(more: number) {
    this.both = () => this.value + more;
  }
}

export class GivenAway {
  value = 19;
  run = (): number => this.value;
  self = (): GivenAway => this;
}

export class Made {
  value = 18;
  run = (): number => this.value;
}
export const makeOne = (): Made => new Made();

export function callAll(core: BehindCode): string {
  return [core.add(1), core.twice(), core.self() === core, core.free(1), core.last(), core.listeners.size, core.table.size].join();
}
export function namesOf(value: object): string {
  return Object.keys(value).join();
}
