// Which overload a call ends in, and which operands an overload is tried with.
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { describe, test } from "../../supported";
import { everyCandidate } from "./instances";
import { Realm } from "./members";
import { operandSetsFor, selectOverload, type Call } from "./operands";
import { needsDifferentialTest, Table, type CallMode } from "./table-description";

const table = new Table(aotBuiltinEntries());
const realm = new Realm(table);

function callOf(path: string, mode: CallMode = "Call"): Call {
  const entry = table.dump.entries.find(other => other.path === path);
  if (!entry) throw new Error(`the table has no ${path}`);
  return { entry, mode, overloads: table.overloadsOf(entry, mode) };
}

function selected(
  path: string,
  receiver: unknown,
  args: unknown[],
  isPristine = true,
  mode: CallMode = "Call",
): string {
  return selectOverload(realm, callOf(path, mode), { receiver, args, isPristine: () => isPristine }).token;
}

describe("the overload of a call", () => {
  test("is the first whose narrow types hold", () => {
    expect(selected("Array.prototype.push", [1], [2])).toBe("ArrayPrototypePush/0");
    expect(selected("Array.prototype.push", [1], [2], false)).toBe("ArrayPrototypePush/1");
    expect(selected("Array.prototype.push", { length: 0 }, [2])).toBe("ArrayPrototypePush/1");
  });

  test("goes by the class of the cell, not by the prototype", () => {
    const disguised = Object.setPrototypeOf({}, Array.prototype);
    expect(selected("Array.prototype.push", disguised, [2])).toBe("ArrayPrototypePush/1");
    expect(realm.classesOf(new Proxy([], {}))).toEqual(["Proxy"]);
    expect(realm.classesOf(Object.setPrototypeOf([], null))).toContain("Array");
    expect(realm.classesOf(new Headers())).toContain("Headers");
  });

  test("tells an argument that is not passed from undefined", () => {
    const withLength = selected("Array", undefined, [3]);
    expect(selected("Array", undefined, [3, undefined])).not.toBe(withLength);
  });

  test("takes a function for an instance of a class of functions only if it is one", () => {
    const path = "Function.prototype[Symbol.hasInstance]";
    const ofBoundFunction = selected(path, function () {}.bind(null), [{}]);
    expect(selected(path, function () {}, [{}])).not.toBe(ofBoundFunction);
  });

  test("takes an object for a parameter with a conversion", () => {
    expect(selected("Math.abs", Math, [{}])).toBe("MathAbs/0");
  });
});

describe("the sets of operands", () => {
  test("have candidates with different names", () => {
    const names = everyCandidate.map(({ name }) => name);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });

  test("pass every candidate in every position", () => {
    const names = new Set(operandSetsFor(realm, callOf("Object.is")).map(({ name }) => name));
    for (const { name, prepare } of everyCandidate) {
      if (prepare) continue;
      expect(names).toContain(`holder(${name}, object:proxy)`);
      expect(names).toContain(`holder(object:proxy, ${name})`);
    }
  });

  test("end with arguments that no parameter takes", () => {
    expect(operandSetsFor(realm, callOf("Object.is")).some(({ surplusCount }) => surplusCount > 0)).toBe(true);
    expect(operandSetsFor(realm, callOf("Math.max")).some(({ surplusCount }) => surplusCount > 0)).toBe(false);
  });

  test("exist for every hand-written overload of a function or method of the engine", () => {
    const without = table.dump.entries
      .filter(entry => entry.origin === "Engine" && (entry.kind === "Function" || entry.kind === "Method"))
      .filter(entry => entry.overloads.some(needsDifferentialTest) && realm.valueOf(entry.token) !== undefined)
      .filter(entry => operandSetsFor(realm, callOf(entry.path)).length === 0)
      .map(entry => entry.path);
    expect(without).toEqual([]);
  });
});
