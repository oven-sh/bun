// A `--define` whose value is a global name or a dotted path of global names stands for that path wherever the defined name is written: read, called with the holder as `this`, under `typeof`, on either side of `in`, stored to, updated, destructured into and deleted.
// Flags: --define LOG=console.log --define ROOT=holder.inner.value --define NAME=target --define DESCRIBE=holder.inner.describe --define FLOOR=Math.floor --define ITERATOR=Symbol.iterator --define process.env.ALIAS=holder.inner.extra
// Reference: bun build --compile
declare const LOG: (...values: unknown[]) => void;
declare let ROOT: any;
declare let NAME: any;
declare const DESCRIBE: (label: string) => string;
declare const FLOOR: (value: number) => number;
declare const ITERATOR: typeof Symbol.iterator;

const globals = globalThis as any;

function attempt(action: () => unknown): unknown {
  try {
    return action();
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

LOG("typeof before the globals exist:", typeof NAME, attempt(() => typeof ROOT));
LOG("read before the globals exist:", attempt(() => NAME), attempt(() => ROOT));
LOG("store before the globals exist:", attempt(() => (NAME = 1)), attempt(() => (ROOT = 1)), "target" in globals, "holder" in globals);

const record: any = {
  inner: {
    describe(label: string): string {
      return `${label}: this is ${this === record.inner ? "the holder" : String(this)}`;
    },
  },
};
let holderReads = 0;
function countHolderReads(): number {
  const count = holderReads;
  holderReads = 0;
  return count;
}
Object.defineProperty(globalThis, "holder", {
  configurable: true,
  get() {
    holderReads++;
    return record;
  },
});
globals.target = "value";

LOG("typeof of a member that is not there:", typeof ROOT, ROOT, countHolderReads());
record.inner.value = 5;
LOG("read:", ROOT, NAME, typeof ROOT, typeof NAME, typeof LOG, countHolderReads());
LOG("shorthand:", JSON.stringify({ ROOT, NAME }), JSON.stringify({ ROOT: 1, NAME: 2 }), { ROOT: 3 }.ROOT, countHolderReads());

function callDetached(detached: (label: string) => string): string {
  return detached("read, then called");
}
LOG("call:", DESCRIBE("called by the defined name"), countHolderReads());
// prettier-ignore
LOG("call:", (DESCRIBE)("parenthesized"), DESCRIBE?.("optional call"), callDetached(DESCRIBE), countHolderReads());
LOG("call:", DESCRIBE.call("another receiver", "through call"), [1].map(() => DESCRIBE("in a closure"))[0], countHolderReads());
LOG("call of built-ins:", FLOOR(2.5), typeof FLOOR, [7, 8][ITERATOR]().next().value, ITERATOR === Symbol.iterator);

ROOT = { value: 1, other: 2 };
LOG("in:", "other" in ROOT, "absent" in ROOT, NAME in ROOT, NAME in { value: 0 }, NAME in {}, countHolderReads());

ROOT = 10;
NAME = 20;
LOG("store:", ROOT, record.inner.value, NAME, globals.target, (ROOT = 11), (NAME = 21), record.inner.value, globals.target);

countHolderReads();
ROOT += 2;
LOG("compound:", ROOT, countHolderReads());
NAME += 3;
ROOT -= 1;
ROOT *= 2;
NAME **= 2;
LOG("compound:", ROOT, NAME, (ROOT += 1), (NAME %= 100));
ROOT ||= "not stored";
NAME &&= 0;
LOG("logical:", ROOT, NAME);
ROOT &&= null;
NAME ||= undefined;
LOG("logical:", ROOT, NAME);
ROOT ??= 1;
NAME ??= 2;
LOG("logical:", ROOT, NAME, (ROOT ??= "not stored"), (NAME ||= "not stored"));

countHolderReads();
LOG("update:", ROOT++, ROOT, countHolderReads());
LOG("update:", ++ROOT, ROOT--, --ROOT, NAME++, ++NAME, NAME--, --NAME, record.inner.value, globals.target);

const a = [30];
[NAME] = a;
[ROOT] = [31];
LOG("array pattern:", NAME, ROOT, globals.target, record.inner.value);
[NAME, ROOT] = [ROOT, NAME];
LOG("array pattern:", NAME, ROOT);
[NAME = 50, ROOT = 51] = [];
LOG("defaults:", NAME, ROOT);
({ a: NAME, b: ROOT } = { a: 40, b: 41 });
LOG("object pattern:", NAME, ROOT);
({ NAME, ROOT } = { NAME: 42, ROOT: 43 });
LOG("shorthand pattern:", NAME, ROOT, globals.target, record.inner.value);
[, ...ROOT] = [1, 2, 3];
({ a: {}, ...NAME } = { a: 1, b: 2 });
LOG("rest:", JSON.stringify(ROOT), JSON.stringify(NAME));

const visited: unknown[] = [];
for (NAME of [1, 2]) visited.push(globals.target);
for (ROOT in { first: 0, second: 0 }) visited.push(record.inner.value);
LOG("loop heads:", visited.join());

record.inner.extra = "extra";
LOG("dotted name:", process.env.ALIAS, typeof process.env.ALIAS);
LOG("delete:", delete process.env.ALIAS, "extra" in record.inner, process.env.ALIAS, delete process.env.ALIAS);
Object.defineProperty(record.inner, "extra", { value: "fixed", configurable: false });
LOG("delete:", attempt(() => delete process.env.ALIAS), process.env.ALIAS);
process.env.ALIAS = "in the environment";
LOG("store to a dotted name:", process.env.ALIAS, Reflect.get(process.env, "ALIAS"));

function shadowed(ROOT: number, NAME: number, LOG: (value: number) => number): number {
  ROOT += 1;
  NAME++;
  return LOG(ROOT + NAME);
}
ROOT = "unchanged";
NAME = "unchanged";
LOG("parameters of the same names:", shadowed(1, 2, value => value * 10), ROOT, NAME);
{
  const ROOT = "block";
  let NAME = "block";
  NAME += " scoped";
  LOG("block bindings of the same names:", ROOT, NAME, record.inner.value, globals.target);
}

class Reader {
  field = ROOT;
  static key = NAME;
  read(fallback = ROOT): unknown {
    return fallback;
  }
  write(value: unknown): void {
    ROOT = value;
  }
}
const reader = new Reader();
reader.write("written in a method");
LOG("in a class:", reader.field, Reader.key, reader.read(), record.inner.value);

delete globals.target;
delete globals.holder;
LOG("after the globals are deleted:", typeof NAME, attempt(() => typeof ROOT), attempt(() => NAME++), attempt(() => (ROOT += 1)));

export {};
