import { describe, expect, test } from "bun:test";
import { type Expectations, type InstanceFacts, type ResultFacts, ExpectationsError, candidates, compare, compareNames, emptyExpectations, parse, selectForTest, serialize, update, verify } from "./expectations";

const inst = (name: string, kind: "E" | "C", more: Partial<InstanceFacts> = {}): [string, InstanceFacts] => [name, { name, casePath: "compiler/" + name.replace(/\(.*\)/, ""), status: "run", reason: "", kind, tags: [], platformLimited: undefined, ...more }];
const res = (name: string, kind: "E" | "C", status: ResultFacts["status"], more: Partial<ResultFacts> = {}): ResultFacts => ({ name, kind, level: "first-section", status, detail: status === "pass" ? "" : "line 1:\n- a\n+ b", ...more });
const byName = (rs: ResultFacts[]) => new Map(rs.map(r => [r.name, r]));

describe("the form of the file", () => {
  test("the empty file", () => {
    expect(serialize(emptyExpectations("first-section"))).toBe('{\n  "level": "first-section",\n  "E": [],\n  "C": []\n}\n');
  });
  test("one name on a line", () => {
    const e: Expectations = { level: "first-section", E: ["a(target=es2015).ts", "a.ts"], C: ["b.tsx"] };
    expect(serialize(e)).toBe('{\n  "level": "first-section",\n  "E": [\n    "a(target=es2015).ts",\n    "a.ts"\n  ],\n  "C": [\n    "b.tsx"\n  ]\n}\n');
    expect(parse(serialize(e))).toEqual(e);
  });
  test("code unit order", () => {
    const names = ["a.ts", "B.ts", "a(x=1).ts", "a1.ts", "_a.ts", "a-b.ts", "aB.ts", "a_b.ts", "ab.ts"];
    expect([...names].sort(compareNames)).toEqual(["B.ts", "_a.ts", "a(x=1).ts", "a-b.ts", "a.ts", "a1.ts", "aB.ts", "a_b.ts", "ab.ts"]);
    expect([...names].sort(compareNames)).toEqual([...names].sort());
  });
  test.each([
    ["not sorted", '{\n  "level": "first-section",\n  "E": [\n    "b.ts",\n    "a.ts"\n  ],\n  "C": []\n}\n', "not sorted"],
    ["twice", '{\n  "level": "first-section",\n  "E": [\n    "a.ts",\n    "a.ts"\n  ],\n  "C": []\n}\n', "twice"],
    ["both lists", '{\n  "level": "first-section",\n  "E": [\n    "a.ts"\n  ],\n  "C": [\n    "a.ts"\n  ]\n}\n', "both lists"],
    ["other form", '{"level":"first-section","E":[],"C":[]}\n', "not in the form"],
    ["no line feed at the end", '{\n  "level": "first-section",\n  "E": [],\n  "C": []\n}', "not in the form"],
    ["carriage returns", '{\r\n  "level": "first-section",\r\n  "E": [],\r\n  "C": []\r\n}\r\n', "not in the form"],
    ["level", '{\n  "level": "codes",\n  "E": [],\n  "C": []\n}\n', "level"],
    ["keys", '{\n  "E": [],\n  "C": []\n}\n', "keys"],
    ["key order", '{\n  "level": "first-section",\n  "C": [],\n  "E": []\n}\n', "keys"],
  ])("refuses: %s", (_label, text, message) => {
    expect(() => parse(text)).toThrow(ExpectationsError);
    expect(() => parse(text)).toThrow(message);
  });
});

describe("verify", () => {
  const instances = new Map([inst("e1.ts", "E"), inst("e2.ts", "E"), inst("c1.ts", "C"), inst("s.ts", "E", { status: "skipped", reason: "unsupported target ES5" }), inst("w.ts", "E", { platformLimited: "win32: link-to-file" })]);
  test("the empty lists run nothing and fail nothing", () => {
    expect(verify(emptyExpectations("first-section"), instances, new Map())).toEqual([]);
  });
  test("every cause", () => {
    const e: Expectations = { level: "first-section", E: ["c1.ts", "e1.ts", "e2.ts", "gone.ts", "s.ts", "w.ts"], C: [] };
    const f = verify(e, instances, byName([res("e1.ts", "E", "pass"), res("e2.ts", "E", "fail")]));
    expect(f.map(x => [x.name, x.cause])).toEqual([["c1.ts", "kind"], ["e2.ts", "fail"], ["gone.ts", "unknown-name"], ["s.ts", "not-run"], ["w.ts", "platform-limited"]]);
    expect(f[1].message).toBe("e2.ts is listed in E and does not pass (fail): line 1:\n- a\n+ b");
  });
  test.each(["provisional", "error", "unsupported"] as const)("status %s of a listed name is a failure", status => {
    const f = verify({ level: "first-section", E: ["e1.ts"], C: [] }, instances, byName([res("e1.ts", "E", status)]));
    expect(f.map(x => x.cause)).toEqual([status]);
  });
  test("a listed name that the caller did not run is a failure, unless the caller selected a part", () => {
    const e: Expectations = { level: "first-section", E: ["e1.ts", "e2.ts"], C: [] };
    expect(verify(e, instances, byName([res("e1.ts", "E", "pass")])).map(x => [x.name, x.cause])).toEqual([["e2.ts", "not-selected"]]);
    expect(verify(e, instances, byName([res("e1.ts", "E", "pass")]), n => n === "e1.ts")).toEqual([]);
  });
  test("a check of a lower level cannot verify a list of a higher level, a higher one can", () => {
    expect(verify({ level: "baseline", E: ["e1.ts"], C: [] }, instances, byName([res("e1.ts", "E", "pass")])).map(x => x.cause)).toEqual(["level"]);
    expect(verify({ level: "first-section", E: ["e1.ts"], C: [] }, instances, byName([res("e1.ts", "E", "pass", { level: "baseline" })]))).toEqual([]);
  });
});

describe("candidates and update", () => {
  const instances = new Map([
    inst("v(strict=true).ts", "E"),
    inst("v(strict=false).ts", "C"),
    inst("e1.ts", "E"),
    inst("c1.ts", "C"),
    inst("w(strict=true).ts", "E", { platformLimited: "win32: link-to-file" }),
    inst("w(strict=false).ts", "C"),
  ]);
  test("a checker that reports nothing adds nothing", () => {
    const results = [res("v(strict=true).ts", "E", "fail"), res("v(strict=false).ts", "C", "pass"), res("e1.ts", "E", "fail"), res("c1.ts", "C", "pass"), res("w(strict=false).ts", "C", "pass")];
    const c = candidates(emptyExpectations("first-section"), instances, results);
    expect(c.admitted).toEqual([]);
    expect(c.refused.map(r => [r.name, r.cause])).toEqual([["c1.ts", "no-listed-variation"], ["v(strict=false).ts", "no-listed-variation"], ["w(strict=false).ts", "no-listed-variation"]]);
  });
  test("a clean instance enters with or after an instance of its case in list E", () => {
    const results = [res("v(strict=true).ts", "E", "pass"), res("v(strict=false).ts", "C", "pass"), res("e1.ts", "E", "pass"), res("c1.ts", "C", "pass"), res("w(strict=true).ts", "E", "pass"), res("w(strict=false).ts", "C", "pass")];
    const c = candidates(emptyExpectations("first-section"), instances, results);
    expect(c.admitted).toEqual([{ name: "e1.ts", list: "E" }, { name: "v(strict=true).ts", list: "E" }, { name: "v(strict=false).ts", list: "C" }]);
    expect(c.refused.map(r => [r.name, r.cause])).toEqual([["w(strict=true).ts", "platform-limited"], ["c1.ts", "no-listed-variation"], ["w(strict=false).ts", "no-listed-variation"]]);
    const next = update({ level: "first-section", E: ["zz.ts"], C: [] }, c.admitted);
    expect(next).toEqual({ level: "first-section", E: ["e1.ts", "v(strict=true).ts", "zz.ts"], C: ["v(strict=false).ts"] });
  });
  test("provisional, failed and unsupported results add nothing", () => {
    const results = [res("e1.ts", "E", "provisional"), res("v(strict=true).ts", "E", "unsupported"), res("c1.ts", "C", "error")];
    expect(candidates(emptyExpectations("first-section"), instances, results)).toEqual({ admitted: [], refused: [] });
  });
  test("update removes nothing and keeps the lines of the names it had", () => {
    const before: Expectations = { level: "first-section", E: ["b.ts", "d.ts"], C: ["x.ts"] };
    const after = update(before, [{ name: "c.ts", list: "E" }, { name: "a.ts", list: "E" }, { name: "b.ts", list: "E" }]);
    expect(after.E).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
    const removedLines = serialize(before).split("\n").filter(l => l.startsWith("    ") && !serialize(after).split("\n").some(m => m.replace(/,$/, "") === l.replace(/,$/, "")));
    expect(removedLines).toEqual([]);
  });
  test("a result of level first-section does not enter a list of level baseline", () => {
    const c = candidates(emptyExpectations("baseline"), instances, [res("e1.ts", "E", "pass")]);
    expect(c).toEqual({ admitted: [], refused: [{ name: "e1.ts", list: "E", cause: "level", message: "compared at level first-section, the list stands for level baseline" }] });
  });
});

describe("comparison with an earlier file", () => {
  test("a name that left a list is reported, a name that moved too", () => {
    const before: Expectations = { level: "first-section", E: ["a.ts", "b.ts", "m.ts"], C: ["c.ts"] };
    const now: Expectations = { level: "first-section", E: ["a.ts", "n.ts"], C: ["c.ts", "m.ts"] };
    expect(compare(before, now)).toEqual({
      removed: [{ name: "b.ts", list: "E", nowIn: undefined }, { name: "m.ts", list: "E", nowIn: "C" }],
      added: [{ name: "n.ts", list: "E" }, { name: "m.ts", list: "C" }],
      levelBefore: "first-section",
      levelNow: "first-section",
      levelLowered: false,
    });
  });
  test("a lower level is reported", () => {
    expect(compare(emptyExpectations("baseline"), emptyExpectations("first-section")).levelLowered).toBe(true);
    expect(compare(emptyExpectations("first-section"), emptyExpectations("baseline")).levelLowered).toBe(false);
  });
});

describe("the names of a run with a limit", () => {
  const e: Expectations = { level: "first-section", E: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"], C: ["x.ts", "y.ts"] };
  test("all of them below the limit", () => {
    expect(selectForTest(e, 8).map(x => x.name)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "x.ts", "y.ts"]);
  });
  test("at even distances above it, the same ones on every run", () => {
    expect(selectForTest(e, 3).map(x => x.name)).toEqual(["a.ts", "c.ts", "f.ts"]);
    expect(selectForTest(e, 4).map(x => x.name)).toEqual(["a.ts", "c.ts", "e.ts", "x.ts"]);
  });
  test("the level of a clean instance does not matter", () => {
    const instances = new Map([inst("c1.ts", "C")]);
    expect(verify({ level: "baseline", E: [], C: ["c1.ts"] }, instances, byName([res("c1.ts", "C", "pass")]))).toEqual([]);
  });
});
