import { rate } from "./rates.ts";

const Untyped: any = class {
  static make() {
    return rate;
  }
};
export const makeUntyped = () => Untyped.make();

const Named = class Inner {
  own = rate;
  read() {
    return [this.own, Inner.name].join();
  }
};
export const makeNamed = () => new Named().read();

let Written = class {
  #held;
  constructor(held: number) {
    this.#held = held + rate;
  }
  get held() {
    return this.#held;
  }
};
export const makeWritten = () => new Written(1).held;

const Base = class {
  who() {
    return rate;
  }
};
const Heir = class extends Base {
  who() {
    return super.who() + 1;
  }
};
export const makeHeir = () => new Heir().who();

const held = {
  Kept: class {
    static make() {
      return rate;
    }
  },
};
export const makeKept = () => held.Kept.make();

const listed = [
  class {
    static make() {
      return rate;
    }
  },
];
export const makeListed = () => listed[0].make();

const { Taken } = {
  Taken: class {
    static make() {
      return rate;
    }
  },
};
export const makeTaken = () => Taken.make();

const Chosen: any =
  1 > 0
    ? class {
        static make() {
          return rate;
        }
      }
    : null;
export const makeChosen = () => Chosen.make();

const Asserted = class {
  static make() {
    return rate;
  }
} as any;
export const makeAsserted = () => Asserted.make();

export const mode = () => `the mode at ${rate}`;
