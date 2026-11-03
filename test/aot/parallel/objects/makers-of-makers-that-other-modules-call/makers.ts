import { args, evaluate } from "./keys.ts";

export type Made = { op: string; [key: string]: any };
type Options = { op: string; [key: string]: any };

const Base = { describe(this: Made) { return this.op + "(" + String(this[args]) + ")"; } };
const makeMembers = (options: Options) => ({ ...Base, op: options.op, [evaluate]: options[evaluate] });

export const makePrimitive = (options: Options) => {
  const members = makeMembers(options);
  return function (value: unknown): Made {
    const self = Object.create(members);
    self[args] = value;
    return self;
  };
};

export function makeCounter(label: string) {
  const members = { label, count: 0 };
  let made = 0;
  return { next() { const self = Object.create(members); self.count = ++made; return self as { label: string; count: number }; } };
}

export const describe = (made: Made): string => made.describe();
