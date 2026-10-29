// Which overload a call ends in, and which operands an overload is tried with.
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { describe, test } from "../../supported";
import { everyCandidate, everyFamily } from "./instances";
import { Realm } from "./members";
import { planFor, selectOverload, type Call, type Outcomes } from "./operands";
import type { OperandSet } from "./runs";
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

const firstSetsOf = (call: Call) => {
  const { sets, sweeps } = planFor(realm, call);
  return [...sets, ...sweeps.flatMap(sweep => sweep.first())];
};
const namesOf = (sets: readonly OperandSet[]) => new Set(sets.map(({ name }) => name));
const outcomesOf = (sets: readonly OperandSet[], signatureOf: (name: string) => string): Outcomes =>
  new Map(sets.map(({ name }) => [name, { signature: signatureOf(name), asked: new Map() }]));
const familyNamed = (name: string) => everyFamily().find(family => family.name === name)!;

describe("the sets of operands", () => {
  test("have candidates with different names", () => {
    const names = everyCandidate.map(({ name }) => name);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });

  test("have every candidate in one family, and a scout in every family", () => {
    const members = everyFamily().flatMap(({ scouts, others }) => [...scouts, ...others]);
    expect(members.map(({ name }) => name).sort()).toEqual(everyCandidate.map(({ name }) => name).sort());
    expect(everyFamily().filter(({ scouts }) => scouts.length === 0)).toEqual([]);
  });

  test("pass the scouts of every family in every position", () => {
    const { sweeps } = planFor(realm, callOf("Bun.deepEquals"));
    expect(sweeps.map(({ operand }) => operand)).toContain(1);
    for (const sweep of sweeps) {
      const names = namesOf(sweep.first());
      for (const scout of everyFamily().flatMap(({ scouts }) => scouts))
        expect(names).toContain(sweep.createSet(scout).name);
    }
  });

  test("pass no object of the host to the engine, which has no test for one", () => {
    expect([...namesOf(firstSetsOf(callOf("Object.is")))].filter(name => name.includes("filled:Headers"))).toEqual([]);
  });

  test("pass a whole family where the table names it", () => {
    const names = namesOf(firstSetsOf(callOf("Math.abs")));
    for (const { name } of familyNamed("number").others) expect(names).toContain(`holder(${name})`);
    expect(names).not.toContain("holder(empty:Map)");
  });

  test("pass a whole family where a scout does something else than a plain object", () => {
    const { sweeps } = planFor(realm, callOf("Object.is"));
    const first = sweeps.flatMap(sweep => sweep.first());
    expect(sweeps.flatMap(sweep => sweep.next(outcomesOf(first, () => "same")))).toEqual([]);
    const told = namesOf(
      sweeps.flatMap(sweep =>
        sweep.next(outcomesOf(first, name => (name === "holder(filled:Map, object:proxy)" ? "other" : "same"))),
      ),
    );
    expect([...told].sort()).toEqual(
      familyNamed("Map")
        .others.map(({ name }) => `holder(${name}, object:proxy)`)
        .sort(),
    );
  });

  test("pass the ordinary objects that answer to a name that is asked for", () => {
    const { sweeps } = planFor(realm, callOf("Object.is"));
    const first = sweeps.flatMap(sweep => sweep.first());
    const outcomes = new Map(outcomesOf(first, () => "same"));
    outcomes.set("holder(object:proxy, object:proxy)", {
      signature: "same",
      asked: new Map([[0, { names: new Set(["then"]), isMoreThanNames: false }]]),
    });
    const told = namesOf(sweeps.flatMap(sweep => sweep.next(outcomes)));
    expect(told).toContain("holder(thenable, object:proxy)");
    expect(told).not.toContain("holder(iterable, object:proxy)");
    expect(told).not.toContain("holder(object:proxy, thenable)");
  });

  test("end with arguments that no parameter takes", () => {
    expect(planFor(realm, callOf("Object.is")).sets.some(({ surplusCount }) => surplusCount > 0)).toBe(true);
    expect(planFor(realm, callOf("Math.max")).sets.some(({ surplusCount }) => surplusCount > 0)).toBe(false);
  });

  test("exist for every hand-written overload of a function or method of the engine", () => {
    const without = table.dump.entries
      .filter(entry => entry.origin === "Engine" && (entry.kind === "Function" || entry.kind === "Method"))
      .filter(entry => entry.overloads.some(needsDifferentialTest) && realm.valueOf(entry.token) !== undefined)
      .filter(entry => planFor(realm, callOf(entry.path)).sets.length === 0)
      .map(entry => entry.path);
    expect(without).toEqual([]);
  });
});
