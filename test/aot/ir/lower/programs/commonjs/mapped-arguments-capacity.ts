// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 2

// FILE: main.ts
// A parameter of a sloppy function that received no argument is stored in the mapped `arguments` object past its length and is not an element of it. Functions with 1, 4 and 40 parameters; the same bodies in a strict file and with a default parameter are not mapped.
import * as groups from "./sloppy.cjs";
import * as strictBodies from "./strict.cjs";
for (const name of Object.keys(groups).sort()) {
  const group = (groups as any)[name];
  if (!Array.isArray(group?.counts)) continue;
  for (const kind of ["sloppy", "strict", "withDefault"]) {
    const body = kind === "strict" ? (strictBodies as any)[name] : group[kind];
    for (const count of group.counts) {
      const list = Array.from({ length: count }, (_, index) => "argument " + index);
      console.log(name + "." + kind + " with " + count + ": " + JSON.stringify(body(...list)));
    }
  }
}
console.log("last allocation: " + (groups as any).lastAllocation());

// FILE: sloppy.cjs
var ring = new Array(64);
function allocate() { for (var i = 0; i < 20000; i++) ring[i & 63] = { index: i }; }
function collect() { allocate(); (globalThis.gc ?? (() => globalThis.Bun.gc(true)))(); allocate(); }
function show(value) { return value === undefined ? "undefined" : value; }
function observe(args, positions) {
  return { length: args.length, elements: positions.map(function (i) { return show(args[i]); }), present: positions.filter(function (i) { return i in args; }) };
}
exports.lastAllocation = function () { return ring[63].index; };
exports.helpers = { collect, show, observe };

exports.oneParameter = {
  counts: [0, 1, 3],
  sloppy: function (a) {
    var args = arguments, positions = [0, 1], log = [observe(args, positions), show(a)];
    a = { a: "direct" };
    collect();
    log.push(a, observe(args, positions));
    (function () { a = { a: "inner" }; })();
    collect();
    log.push((function () { return a; })(), observe(args, positions));
    (() => { a = { a: "arrow" }; })();
    collect();
    log.push((() => a)(), observe(args, positions));
    args[0] = "element 0";
    log.push(show(a), observe(args, positions));
    return log;
  },
  withDefault: function (a = undefined) {
    var args = arguments, positions = [0, 1], log = [observe(args, positions), show(a)];
    a = { a: "direct" };
    collect();
    log.push(a, observe(args, positions));
    (function () { a = { a: "inner" }; })();
    collect();
    log.push((function () { return a; })(), observe(args, positions));
    (() => { a = { a: "arrow" }; })();
    collect();
    log.push((() => a)(), observe(args, positions));
    args[0] = "element 0";
    log.push(show(a), observe(args, positions));
    return log;
  },
};

exports.fourParameters = {
  counts: [0, 2, 4, 6],
  sloppy: function (a, b, c, d) {
    var args = arguments, positions = [0, 1, 2, 3, 4, 5], log = [observe(args, positions), [a, b, c, d].map(show)];
    a = { a: "direct" };
    d = { d: "direct" };
    (function () { b = { b: "inner" }; })();
    (() => { c = { c: "arrow" }; })();
    collect();
    log.push([a, b, c, d], (function () { return [a, b, c, d]; })(), (() => [a, b, c, d])(), observe(args, positions));
    args[3] = "element 3";
    log.push(show(d), observe(args, positions));
    return log;
  },
  withDefault: function (a, b, c, d = undefined) {
    var args = arguments, positions = [0, 1, 2, 3, 4, 5], log = [observe(args, positions), [a, b, c, d].map(show)];
    a = { a: "direct" };
    d = { d: "direct" };
    (function () { b = { b: "inner" }; })();
    (() => { c = { c: "arrow" }; })();
    collect();
    log.push([a, b, c, d], (function () { return [a, b, c, d]; })(), (() => [a, b, c, d])(), observe(args, positions));
    args[3] = "element 3";
    log.push(show(d), observe(args, positions));
    return log;
  },
};

exports.fortyParameters = {
  counts: [0, 3, 40, 45],
  sloppy: function (p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31, p32, p33, p34, p35, p36, p37, p38, p39) {
    var args = arguments, positions = [0, 2, 3, 37, 38, 39, 40, 44], log = [observe(args, positions)];
    p0 = { p0: "direct" };
    p39 = { p39: "direct" };
    (function () { p3 = { p3: "inner" }; p38 = { p38: "inner" }; })();
    (() => { p2 = { p2: "arrow" }; p37 = { p37: "arrow" }; })();
    collect();
    log.push([p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31, p32, p33, p34, p35, p36, p37, p38, p39].map(show));
    log.push((function () { return [p0, p2, p3, p37, p38, p39]; })(), (() => [p0, p2, p3, p37, p38, p39])(), observe(args, positions));
    args[39] = "element 39";
    log.push(show(p39), observe(args, positions));
    return log;
  },
  withDefault: function (p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31, p32, p33, p34, p35, p36, p37, p38, p39 = undefined) {
    var args = arguments, positions = [0, 2, 3, 37, 38, 39, 40, 44], log = [observe(args, positions)];
    p0 = { p0: "direct" };
    p39 = { p39: "direct" };
    (function () { p3 = { p3: "inner" }; p38 = { p38: "inner" }; })();
    (() => { p2 = { p2: "arrow" }; p37 = { p37: "arrow" }; })();
    collect();
    log.push([p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31, p32, p33, p34, p35, p36, p37, p38, p39].map(show));
    log.push((function () { return [p0, p2, p3, p37, p38, p39]; })(), (() => [p0, p2, p3, p37, p38, p39])(), observe(args, positions));
    args[39] = "element 39";
    log.push(show(p39), observe(args, positions));
    return log;
  },
};

// FILE: strict.cjs
"use strict";
var { collect, show, observe } = require("./sloppy.cjs").helpers;

exports.oneParameter = function (a) {
  var args = arguments, positions = [0, 1], log = [observe(args, positions), show(a)];
  a = { a: "direct" };
  collect();
  log.push(a, observe(args, positions));
  (function () { a = { a: "inner" }; })();
  collect();
  log.push((function () { return a; })(), observe(args, positions));
  (() => { a = { a: "arrow" }; })();
  collect();
  log.push((() => a)(), observe(args, positions));
  args[0] = "element 0";
  log.push(show(a), observe(args, positions));
  return log;
};

exports.fourParameters = function (a, b, c, d) {
  var args = arguments, positions = [0, 1, 2, 3, 4, 5], log = [observe(args, positions), [a, b, c, d].map(show)];
  a = { a: "direct" };
  d = { d: "direct" };
  (function () { b = { b: "inner" }; })();
  (() => { c = { c: "arrow" }; })();
  collect();
  log.push([a, b, c, d], (function () { return [a, b, c, d]; })(), (() => [a, b, c, d])(), observe(args, positions));
  args[3] = "element 3";
  log.push(show(d), observe(args, positions));
  return log;
};

exports.fortyParameters = function (p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31, p32, p33, p34, p35, p36, p37, p38, p39) {
  var args = arguments, positions = [0, 2, 3, 37, 38, 39, 40, 44], log = [observe(args, positions)];
  p0 = { p0: "direct" };
  p39 = { p39: "direct" };
  (function () { p3 = { p3: "inner" }; p38 = { p38: "inner" }; })();
  (() => { p2 = { p2: "arrow" }; p37 = { p37: "arrow" }; })();
  collect();
  log.push([p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31, p32, p33, p34, p35, p36, p37, p38, p39].map(show));
  log.push((function () { return [p0, p2, p3, p37, p38, p39]; })(), (() => [p0, p2, p3, p37, p38, p39])(), observe(args, positions));
  args[39] = "element 39";
  log.push(show(p39), observe(args, positions));
  return log;
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
