// Functions written for the test, whose behavior is therefore known: each kind of change is noticed, and what native code may do is not taken for one.
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { undefinedCandidate } from "../differential/instances";
import { Realm } from "../differential/members";
import { Table, type OperandUse } from "../differential/table-description";
import { checkTarget, type TargetReport } from "./check-target";
import type { Target } from "./targets";

const realm = new Realm(new Table(aotBuiltinEntries()));

function check(callee: Function): Promise<TargetReport> {
  const target: Target = {
    name: "fixture",
    path: "fixture",
    mode: "Call",
    isInTable: false,
    declaredUses: [],
    invocation: { mode: "Call", callee, key: "fixture", callsWhatIsRead: false },
    receivers: [undefinedCandidate],
    hasOwnReceiver: true,
    length: callee.length,
    argumentCount: Math.max(callee.length, 1),
  };
  return checkTarget(realm, target);
}

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value);

type Case = { title: string; use: OperandUse; where?: RegExp; set?: RegExp; callee: Function };

const kept: unknown[] = [];

const cases: Case[] = [
  {
    title: "stores under a name",
    use: "StoresByKey",
    where: /^argument 0$/,
    callee(operand: any) {
      if (isPlainObject(operand)) operand.stored = 1;
    },
  },
  {
    title: "stores into its second argument",
    use: "StoresByKey",
    where: /^argument 1$/,
    callee(_: unknown, operand: any) {
      if (isPlainObject(operand)) operand.stored = 1;
    },
  },
  {
    title: "stores into this",
    use: "StoresByKey",
    where: /^this$/,
    callee(this: any) {
      if (isPlainObject(this)) this.stored = 1;
    },
  },
  {
    title: "stores and throws",
    use: "StoresByKey",
    callee(operand: any) {
      if (isPlainObject(operand)) operand.stored = 1;
      throw new TypeError("refused");
    },
  },
  {
    title: "stores after it has returned",
    use: "StoresByKey",
    callee(operand: any) {
      if (isPlainObject(operand)) queueMicrotask(() => void (operand.stored = 1));
    },
  },
  {
    title: "defines an accessor",
    use: "TakesDescriptor",
    callee(operand: any) {
      if (isPlainObject(operand)) Object.defineProperty(operand, "defined", { get: () => 1, configurable: true });
    },
  },
  {
    title: "deletes a property",
    use: "DeletesByKey",
    callee(operand: any) {
      if (isPlainObject(operand)) delete operand.a;
    },
  },
  {
    title: "freezes",
    use: "ChangesIntegrity",
    callee(operand: any) {
      if (isPlainObject(operand)) Object.freeze(operand);
    },
  },
  {
    title: "gives another prototype",
    use: "ChangesPrototype",
    callee(operand: any) {
      if (isPlainObject(operand)) Object.setPrototypeOf(operand, {});
    },
  },
  {
    title: "makes its operand a prototype",
    use: "BecomesPrototype",
    callee: (operand: any) => (isPlainObject(operand) ? Object.create(operand) : undefined),
  },
  {
    title: "appends to an array",
    use: "WritesContents",
    callee(operand: any) {
      if (Array.isArray(operand)) Array.prototype.push.call(operand, 1);
    },
  },
  {
    title: "removes an element",
    use: "WritesContents",
    callee(operand: any) {
      if (Array.isArray(operand)) operand.length = 0;
    },
  },
  {
    title: "writes bytes",
    use: "WritesContents",
    callee(operand: any) {
      if (ArrayBuffer.isView(operand)) new Uint8Array(operand.buffer).fill(7);
    },
  },
  {
    title: "detaches a buffer",
    use: "WritesContents",
    set: /ArrayBuffer/,
    callee(operand: any) {
      if (operand instanceof ArrayBuffer && !operand.detached) operand.transfer();
    },
  },
  {
    title: "adds an entry to a map",
    use: "WritesContents",
    set: /Map/,
    callee(operand: any) {
      if (operand instanceof Map) Map.prototype.set.call(operand, "added", 1);
    },
  },
  {
    title: "sets the time of a date",
    use: "WritesContents",
    set: /Date/,
    callee(operand: any) {
      if (operand instanceof Date) Date.prototype.setTime.call(operand, 1);
    },
  },
  {
    title: "replaces an option by its normal form",
    use: "StoresByKey",
    set: /bag:strings/,
    callee(options: any) {
      if (isPlainObject(options) && typeof options.port === "string") options.port = 0;
    },
  },
  {
    title: "fills in an option one level down",
    use: "StoresByKey",
    where: /depth 1 of argument 0/,
    set: /bag:nested/,
    callee(options: any) {
      if (isPlainObject(options) && isPlainObject(options.tls) && options.tls.serverName === "a")
        options.tls.normalized = true;
    },
  },
  {
    title: "stores into what its callback returns",
    use: "StoresByKey",
    where: /what argument 0 returned/,
    callee(callback: any) {
      if (typeof callback === "function") callback().stored = 1;
    },
  },
  {
    title: "stores into an element of its operand",
    use: "StoresByKey",
    where: /depth 1 of argument 0/,
    callee(operand: any) {
      if (Array.isArray(operand) && isPlainObject(operand[0])) operand[0].stored = 1;
    },
  },
];

describe("a function is noticed that", () => {
  for (const { title, use, where = /./, set = /./, callee } of cases) {
    test(title, async () => {
      const { changes } = await check(callee);
      expect(
        changes.filter(change => change.use === use && where.test(change.where) && set.test(change.set)),
      ).not.toBeEmpty();
    });
  }
});

test("reading, calling, keeping and returning an operand is no change", async () => {
  const report = await check(function (this: unknown, first: any, second: any) {
    kept.push(first, second, this);
    if (kept.length > 64) kept.length = 0;
    if (typeof first === "function") first(second);
    if (isPlainObject(first))
      void [first.port, Object.keys(first), Object.getPrototypeOf(first), "a" in first, JSON.stringify(first.a)];
    if (Array.isArray(second)) return second.slice();
    return first;
  });
  expect(report.changes).toEqual([]);
  expect(report.returned).toBeGreaterThan(100);
  expect(report.callsOperands).toBe("BeforeReturn");
  expect(report.namesRead[0]).toContain("port");
});
