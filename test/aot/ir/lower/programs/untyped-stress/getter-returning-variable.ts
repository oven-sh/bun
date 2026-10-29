// RUN: lower
// OPTIONS: builtin-modules
// CWD: parallel/untyped-stress/getter-returning-variable
// STATISTIC: SourceFilesChecked = 3
// STATISTIC: SourceFilesInferred = 1

// FILE: parallel/untyped-stress/getter-returning-variable/main.ts
// Getters that return a captured variable whose value and type change.
import "../../../fixtures/jsc-shell-functions.ts";
import "./program.ts";

// FILE: fixtures/jsc-shell-functions.ts
// Some of these programs were written for the `jsc` shell. This module defines the shell's global functions that they use, both
// under plain Bun and in a compiled executable. A program that needs them imports this module first.
import { drainMicrotasks, edenGC, fullGC, heapStats, jscDescribe } from "bun:jsc";
import { runInNewContext } from "node:vm";

// heapStats() also answers with the statistics of the allocator and with the kinds of the protected cells: some 170 objects that the
// shell's function does not make. A program that counts cells collects first, and a collection keeps what a word left on the stack
// still names: a cell or two. For one of these objects to be no more than that, none of them refers to another once this has run.
function separate(whole: any, listed?: unknown[]): void {
  if (Array.isArray(whole)) {
    listed?.push(...whole);
    for (let index = 0; index < whole.length; index++) cut(whole, index, listed);
  } else for (const key in whole) cut(whole, key, listed);
}
function cut(whole: any, key: string | number, listed?: unknown[]): void {
  const part = whole[key];
  if (typeof part !== "object" || part === null) return;
  whole[key] = undefined;
  separate(part, listed);
}
function statisticsAsTheShellGivesThem(listed?: unknown[]): any {
  const statistics: any = heapStats();
  const { objectTypeCounts } = statistics;
  statistics.objectTypeCounts = undefined;
  separate(statistics, listed);
  statistics.objectTypeCounts = objectTypeCounts;
  return statistics;
}
// An object also keeps its Structure, and that one the Structures it came from. Most of these objects stand in lists, many of one form.
// Those of one answer stay for good, so that the Structures of these forms are there whether or not a word names such an object.
let listedInOneAnswer: unknown[] | undefined;

Object.assign(globalThis, {
  // These only influence the JIT, never what a function does.
  noInline: () => {},
  neverInlineFunction: () => {},
  noDFG: () => {},
  noFTL: () => {},
  noOSRExitFuzzing: () => {},
  fullGC,
  edenGC,
  drainMicrotasks,
  gc: () => Bun.gc(true),
  describe: jscDescribe,
  generateHeapSnapshot: () => Bun.generateHeapSnapshot(),
  memoryUsageStatistics: () => {
    if (!listedInOneAnswer) statisticsAsTheShellGivesThem((listedInOneAnswer = []));
    return statisticsAsTheShellGivesThem();
  },
  jscOptions: () => ({}),
  createGlobalObject: () => runInNewContext("globalThis"),
  preciseTime: () => performance.now() / 1000,
  sleepSeconds: (seconds: number) => Bun.sleepSync(seconds * 1000),
});

// FILE: parallel/untyped-stress/getter-returning-variable/impl.js
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function repeat(f) {
    for (let i = 0; i < 200; i++)
        f(i);
}
function throwsReferenceError(f, what) {
    try {
        f();
    } catch (error) {
        check(error instanceof ReferenceError, true, what);
        return;
    }
    throw new Error(what + ": did not throw");
}

let live = 1;
const fixed = "fixed";
function declared() { return "declared"; }
class Declared { }

const getLive = () => live;
const getFixed = () => fixed;
const getDeclared = () => declared;
const getClass = () => Declared;
const getLater = () => later;
const getLivePlusOne = () => live + 1;
const getConstant = () => 5;
function makeGetLocal() { let local = "local"; return { get: function getLocal() { return local; }, set(value) { local = value; } }; }
const local = makeGetLocal();

function define(target, all) {
    for (const name in all)
        Object.defineProperty(target, name, { get: all[name], enumerable: true, configurable: true });
    return target;
}

function readLive(o) { return o.live; }
function readFixed(o) { return o.fixed; }
function readDeclared(o) { return o.declared; }
function readClass(o) { return o.Declared; }
function readLater(o) { return o.later; }
function readOther(o) { return o.other; }
for (const f of [readLive, readFixed, readDeclared, readClass, readLater, readOther])
    noInline(f);

const ns = define({}, { live: getLive, fixed: getFixed, declared: getDeclared, Declared: getClass, later: getLater });

repeat(i => {
    live = i;
    check(readLive(ns), i, "a variable that changes");
});
live = "text";
check(readLive(ns), "text", "a variable of another type");
live = undefined;
check(readLive(ns), undefined, "a variable that is undefined");
live = null;
check(readLive(ns), null, "a variable that is null");
live = 0;
check(readLive(ns), 0, "a variable that is zero");
repeat(() => check(readFixed(ns), "fixed", "a constant"));
repeat(() => check(readDeclared(ns)(), "declared", "a function declaration"));
repeat(() => check(readClass(ns), Declared, "a class"));

repeat(() => throwsReferenceError(() => readLater(ns), "a variable that is not initialized"));
let later = "now";
repeat(() => check(readLater(ns), "now", "a variable that has been initialized"));

{
    const first = define({}, { other: getLive });
    const second = define({}, { other: getFixed });
    const third = define({}, { other: getLivePlusOne });
    const fourth = define({}, { other: local.get });
    live = 10;
    repeat(() => {
        check(readOther(first), 10, "the first of four objects with the same shape");
        check(readOther(second), "fixed", "the second of four objects with the same shape");
        check(readOther(third), 11, "the third of four objects with the same shape");
        check(readOther(fourth), "local", "the fourth of four objects with the same shape");
    });
    local.set("changed");
    check(readOther(fourth), "changed", "a variable of a function");
}

function readInherited(o) { return o.live; }
noInline(readInherited);
{
    const inheriting = Object.create(ns);
    repeat(i => {
        live = i;
        check(readInherited(inheriting), i, "a getter that is inherited");
    });
}

function readRedefined(o) { return o.value; }
noInline(readRedefined);
{
    const target = define({}, { value: getFixed });
    repeat(() => check(readRedefined(target), "fixed", "before the getter is replaced"));
    define(target, { value: getConstant });
    repeat(() => check(readRedefined(target), 5, "after the getter is replaced by one that returns no variable"));
    live = "live";
    define(target, { value: getLive });
    repeat(() => check(readRedefined(target), "live", "after the getter is replaced by one that returns another variable"));
    Object.defineProperty(target, "value", { value: "plain" });
    repeat(() => check(readRedefined(target), "plain", "after the getter is replaced by a value"));
}

function accessProp(key) { return this[key]; }
function readThroughBoth(o) { return o.live; }
function readLaterThroughBoth(o) { return o.evenLater; }
noInline(readThroughBoth);
noInline(readLaterThroughBoth);
{
    const inner = define({}, { live: getLive, evenLater: () => evenLater });
    const outer = {};
    for (const key of Object.getOwnPropertyNames(inner))
        Object.defineProperty(outer, key, { get: accessProp.bind(inner, key), enumerable: true });
    repeat(i => {
        live = i;
        check(readThroughBoth(outer), i, "through a bound function and a getter");
    });
    repeat(() => throwsReferenceError(() => readLaterThroughBoth(outer), "through both, not initialized"));
    define(inner, { live: getConstant });
    repeat(() => check(readThroughBoth(outer), 5, "through both, after the inner getter is replaced"));
    define(inner, { live: getFixed });
    repeat(() => check(readThroughBoth(outer), "fixed", "through both, after the inner getter is replaced again"));
    Object.defineProperty(inner, "live", { value: "plain", writable: true });
    repeat(() => check(readThroughBoth(outer), "plain", "through both, after the inner getter becomes a value"));
}
let evenLater = 1;

function readValue(o) { return o.value; }
noInline(readValue);
{
    function makeCell(initial) {
        let value = initial;
        return Object.defineProperty({ set(next) { value = next; } }, "value", { get: () => value, enumerable: true });
    }
    const cells = [];
    for (let i = 0; i < 8; i++)
        cells.push(makeCell("cell " + i));
    repeat(i => check(readValue(cells[i % 8]), "cell " + i % 8, "closures of one function, each with its own variable"));
    cells[3].set("changed");
    repeat(i => check(readValue(cells[i % 8]), i % 8 == 3 ? "changed" : "cell " + i % 8, "after one of the variables changes"));

    function makeNested(initial) {
        let value = initial;
        return (function () {
            let unrelated = "unrelated";
            return [Object.defineProperty({ }, "value", { get: () => value }), () => unrelated, next => { value = next; }];
        })();
    }
    const [nested, , setNested] = makeNested("outer variable");
    repeat(() => check(readValue(nested), "outer variable", "a variable two scopes out"));
    setNested("set");
    repeat(() => check(readValue(nested), "set", "a variable two scopes out, changed"));

    for (let round = 0; round < 5; round++) {
        (function () {
            const shortLived = makeCell("round " + round);
            repeat(() => check(readValue(shortLived), "round " + round, "a cell that is about to die"));
        })();
        fullGC();
        const fillers = [];
        for (let i = 0; i < 200; i++)
            fillers.push(makeCell("filler " + i));
        repeat(i => check(readValue(fillers[i]), "filler " + i, "cells made after a collection"));
    }
}
console.log("passed");

// FILE: parallel/untyped-stress/getter-returning-variable/program.ts
import "./impl.js";

// FILE: fixtures/tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// FILE: parallel/tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
