// Functions written for the test, whose behavior is therefore known: each kind of change is noticed, and what native code may do is not taken for one.
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readSync, writeSync } from "node:fs";
import { types } from "node:util";
import { undefinedCandidate } from "../differential/instances";
import { Realm } from "../differential/members";
import { Table, type OperandUse } from "../differential/table-description";
import { checkTarget, type TargetReport } from "./check-target";
import type { Target } from "./targets";

const realm = new Realm(new Table(aotBuiltinEntries()));
// The realm finds the built-in objects of the table when it is first asked about one. In a debug build that takes longer than a test may.
realm.isKnownObject(globalThis);

function check(callee: Function, path = "fixture"): Promise<TargetReport> {
  const target: Target = {
    name: "fixture",
    path,
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

// Closed before the answer, the number of the descriptor names the next file that the test opens, and the member works on that file.
test("a descriptor stays open until the member that was handed it has answered", async () => {
  using folder = tempDir("aot-late-answer", {});
  const foundAnotherFile: string[] = [];
  const filesBehindOtherFunctions = new Set<string>();
  const hasAnswered = { throughCallback: false, throughPromise: false };
  let files = 0;
  let unanswered = 0;
  const markOf = (descriptor: number): string => {
    const bytes = Buffer.alloc(8);
    try {
      return bytes.toString("latin1", 0, readSync(descriptor, bytes, 0, bytes.length, 0));
    } catch (error) {
      return String((error as NodeJS.ErrnoException).code);
    }
  };
  // The work of a call takes two tasks: the one wait that every call gets is over before it is done. It marks the file of its
  // descriptor, unless an earlier call has, and looks for the mark behind the same number when it is done.
  function work(descriptor: number, answer: () => void): string {
    let mark = markOf(descriptor);
    if (!mark.startsWith("file ")) writeSync(descriptor, (mark = `file ${String(files++).padStart(3, "0")}`), 0);
    unanswered++;
    setImmediate(() =>
      setImmediate(() => {
        const found = markOf(descriptor);
        if (found !== mark) foundAnotherFile.push(`${mark}: ${JSON.stringify(found)}`);
        unanswered--;
        answer();
      }),
    );
    return mark;
  }

  // The files of the descriptors are made in the working folder.
  const workingFolder = process.cwd();
  process.chdir(String(folder));
  try {
    // Like the members of node:fs that leave their work with another thread: one answers through its first argument, the other
    // through the promise that it returns.
    const { callsOperands } = await check(function (callback: unknown, descriptor: unknown) {
      if (typeof callback !== "function" || typeof descriptor !== "number") throw new TypeError("refused");
      const file = work(descriptor, () => {
        hasAnswered.throughCallback = true;
        // A class that is handed over as the callback throws when it is called.
        try {
          callback(null);
        } catch {}
      });
      // A function that is no callback of the test does not show when it is called. Each is handed the one file that is never closed.
      if (!types.isProxy(callback)) filesBehindOtherFunctions.add(file);
    }, "%NodeJSFS%.prototype.fixtureCb");
    await check(function (descriptor: unknown) {
      if (typeof descriptor !== "number") throw new TypeError("refused");
      return new Promise<void>(resolve =>
        work(descriptor, () => {
          hasAnswered.throughPromise = true;
          resolve();
        }),
      );
    }, "%NodeJSFS%.prototype.fixture");
    while (unanswered > 0) await new Promise(resolve => setImmediate(resolve));

    expect({
      foundAnotherFile,
      hasAnswered,
      callsOperands,
      filesBehindOtherFunctions: filesBehindOtherFunctions.size,
    }).toEqual({
      foundAnotherFile: [],
      hasAnswered: { throughCallback: true, throughPromise: true },
      callsOperands: "AfterReturn",
      filesBehindOtherFunctions: 1,
    });
  } finally {
    process.chdir(workingFolder);
  }
});
