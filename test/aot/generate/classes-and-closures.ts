// The programs of classes-and-closures that are mostly a loop written out: thousands of fields, variables or functions that differ in a number.
import { programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "class-members-changed-after-hot-calls.js": text(
      `// Calls, getters, static reads and absent names that are resolved from a class declaration must follow every later change to the class. Each case has its own classes and runs a hot loop three times. The second run makes one change halfway, through an alias.
let sums;

function run(use, change) {
  sums = { steps: 0, g: 0, missing: 0, s: 0, f: 0, staticMissing: 0, constructors: 0, instances: 0, aM: 0, bM: 0, cM: 0, n: 0, t: 0, declaredStacks: 0, declaredStaticStacks: 0 };
  let outcome = "finished";
  try {
    use(change);
  } catch (error) {
    outcome = error instanceof TypeError ? "TypeError" : "another error";
  }
  return outcome + ": " + Object.entries(sums).map(([name, sum]) => name + " " + sum).join(", ");
}

function doNothing() {}

function check(title, use, getTarget, change) {
  let result;
  const changeThroughAlias = () => {
    for (const alias of [{}, function () {}, getTarget()]) result = change(alias);
  };
  console.log(title);
  console.log("  before " + run(use, doNothing));
  console.log("  during " + run(use, changeThroughAlias));
  console.log("  after " + run(use, doNothing));
  console.log("  the change returned " + result);
}

const otherPrototype = { m() { return 27; }, get g() { return 28; } };
const otherParent = { s() { return 29; }, f: 30 };
class D { m() { return 40; } }`,
      [
        `A.prototype.m is replaced", use1, () => A1.prototype, alias => { alias.m = function () { return 20; }; }
A.prototype.m is deleted", use2, () => A2.prototype, alias => delete alias.m
A.prototype.m becomes an accessor", use3, () => A3.prototype, alias => { Object.defineProperty(alias, "m", { get() { return () => 21; }, configurable: true }); }
B.prototype gets its own m", use4, () => B4.prototype, alias => { alias.m = function () { return 22; }; }
A.prototype gets the absent name", use5, () => A5.prototype, alias => { alias.missing = 23; }
B gets the absent name", use6, () => B6, alias => { alias.missing = 24; }
B gets its own s", use7, () => B7, alias => { alias.s = function () { return 25; }; }
B gets its own f", use8, () => B8, alias => { alias.f = 26; }
B.prototype gets another prototype", use9, () => B9.prototype, alias => { Object.setPrototypeOf(alias, otherPrototype); }
B gets another prototype", use10, () => B10, alias => { Object.setPrototypeOf(alias, otherParent); }
B gets Symbol.hasInstance", use11, () => B11, alias => { Object.defineProperty(alias, Symbol.hasInstance, { value: () => false }); }
A.prototype.constructor is replaced", use12, () => A12.prototype, alias => { alias.constructor = 1; }
A.prototype.g gets another getter", use13, () => A13.prototype, alias => { Object.defineProperty(alias, "g", { get() { return 31; }, configurable: true }); }
A.s is replaced", use14, () => A14, alias => { alias.s = function () { return 32; }; }
A.f is stored", use15, () => A15, alias => { alias.f = 0.5; }`,
        (n, a) => `
class A${n + 1} { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B${n + 1} extends A${n + 1} {}
class C${n + 1} extends B${n + 1} { m() { return 10 + super.m(); } }
const a${n + 1} = new A${n + 1}();
const b${n + 1} = new B${n + 1}();
const c${n + 1} = new C${n + 1}();
function use${n + 1}(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b${n + 1}.g;
    sums.missing += b${n + 1}.missing ?? 0;
    sums.s += B${n + 1}.s();
    sums.f += B${n + 1}.f;
    sums.staticMissing += B${n + 1}.missing ?? 0;
    if (a${n + 1}.constructor === A${n + 1}) sums.constructors++;
    if (b${n + 1} instanceof B${n + 1}) sums.instances++;
    sums.aM += a${n + 1}.m();
    sums.bM += b${n + 1}.m();
    sums.cM += c${n + 1}.m();
  }
}
check("${a});`,
      ],
      `
class A16 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B16 extends A16 {}
class C16 extends B16 { m() { return 10 + super.m(); } }
const a16 = new A16();
const b16 = new B16();
const c16 = new C16();
function use16(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b16.g;
    sums.missing += b16.missing ?? 0;
    sums.s += B16.s();
    sums.f += B16.f;
    sums.staticMissing += B16.missing ?? 0;
    if (a16.constructor === A16) sums.constructors++;
    if (b16 instanceof B16) sums.instances++;
    sums.aM += a16.m();
    sums.bM += b16.m();
    sums.cM += c16.m();
  }
}
check("A.f is deleted", use16, () => A16, alias => delete alias.f);`,
      [
        `: A.name and A.length are read", use17, () => A17, alias => alias.name + " " + alias.length
: A is frozen", use18, () => A18, alias => Object.isFrozen(Object.freeze(alias))
: A.prototype is frozen", use19, () => A19.prototype, alias => Object.isFrozen(Object.freeze(alias))
: the keys of A.prototype are listed", use20, () => A20.prototype, alias => Object.keys(alias).length
: the unrelated class D changes", use21, () => D.prototype, alias => { alias.m = function () { return 41; }; return new D().m(); }
 for a and b: C.prototype.m is replaced", use22, () => C22.prototype, alias => { alias.m = function () { return 42; }; }`,
        (n, a) => `
class A${n + 17} { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B${n + 17} extends A${n + 17} {}
class C${n + 17} extends B${n + 17} { m() { return 10 + super.m(); } }
const a${n + 17} = new A${n + 17}();
const b${n + 17} = new B${n + 17}();
const c${n + 17} = new C${n + 17}();
function use${n + 17}(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b${n + 17}.g;
    sums.missing += b${n + 17}.missing ?? 0;
    sums.s += B${n + 17}.s();
    sums.f += B${n + 17}.f;
    sums.staticMissing += B${n + 17}.missing ?? 0;
    if (a${n + 17}.constructor === A${n + 17}) sums.constructors++;
    if (b${n + 17} instanceof B${n + 17}) sums.instances++;
    sums.aM += a${n + 17}.m();
    sums.bM += b${n + 17}.m();
    sums.cM += c${n + 17}.m();
  }
}
check("no change${a});`,
      ],
      `
class A23 { m() { return 1; } get stack() { return "declared"; } static s() { return 3; } static get stack() { return "declared"; } }
class B23 extends A23 {}
const b23 = new B23();
function use23(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.s += B23.s();
    sums.bM += b23.m();
    if (b23.stack === "declared") sums.declaredStacks++;
    if (B23.stack === "declared") sums.declaredStaticStacks++;
  }
}
check("native code stores stack on B.prototype", use23, () => B23.prototype, alias => { Error.captureStackTrace(alias); });

class A24 { m() { return 1; } get stack() { return "declared"; } static s() { return 3; } static get stack() { return "declared"; } }
class B24 extends A24 {}
const b24 = new B24();
function use24(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.s += B24.s();
    sums.bM += b24.m();
    if (b24.stack === "declared") sums.declaredStacks++;
    if (B24.stack === "declared") sums.declaredStaticStacks++;
  }
}
check("native code stores stack on B", use24, () => B24, alias => { Error.captureStackTrace(alias); });

function computeKey(key) {
  return key;
}

class A25 { m() { return 1; } }
class B25 extends A25 { [computeKey("m")]() { return 2; } }
class C25 extends B25 { n() { return 3; } }
const a25 = new A25();
const c25 = new C25();
function use25(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.aM += a25.m();
    sums.cM += c25.m();
    sums.n += c25.n();
  }
}
check("C.prototype.n is replaced below a computed name that spells m", use25, () => C25.prototype, alias => { alias.n = function () { return 43; }; });

class A26 { [Symbol.iterator]() { return [5][Symbol.iterator](); } m() { return 1; } static [computeKey("u")]() { return 6; } static s() { return 3; } }
class B26 extends A26 { n() { return 2; } static t() { return 4; } }
const b26 = new B26();
function use26(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.s += B26.s();
    sums.t += B26.t();
    sums.bM += b26.m();
    sums.n += b26.n();
  }
}
check("B.prototype.n is replaced below computed names", use26, () => B26.prototype, alias => { alias.n = function () { return 44; }; });
console.log("  computed members " + [...b26].join() + " " + B26.u());

class A27 { [Symbol.iterator]() { return [5][Symbol.iterator](); } m() { return 1; } static [computeKey("u")]() { return 6; } static s() { return 3; } }
class B27 extends A27 { n() { return 2; } static t() { return 4; } }
const b27 = new B27();
function use27(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.s += B27.s();
    sums.t += B27.t();
    sums.bM += b27.m();
    sums.n += b27.n();
  }
}
check("B gets its own s below computed names", use27, () => B27, alias => { alias.s = function () { return 45; }; });

class A28 { [computeKey("k")]() { return 7; } m() { return 1; } static [computeKey("u")]() { return 6; } static s() { return 3; } }
class B28 extends A28 { n() { return 2; } static t() { return 4; } }
const b28 = new B28();
function use28(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.s += B28.s();
    sums.t += B28.t();
    sums.bM += b28.m();
    sums.n += b28.n();
  }
}
check("A.prototype.m is replaced beside a computed name", use28, () => A28.prototype, alias => { alias.m = function () { return 46; }; });

class A29 { m() { return 1; } static s() { return 3; } static get stack() { return "declared"; } }
class B29 extends A29 {}
const b29 = new B29();
function use29(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.s += B29.s();
    sums.bM += b29.m();
    if (A29.stack === "declared") sums.declaredStaticStacks++;
    if (B29.stack === "declared") sums.declaredStaticStacks++;
  }
}
check("native code stores stack on A, the parent of B", use29, () => A29, alias => { Error.captureStackTrace(alias); });
`,
    ),
    "600-classes-with-method-fields.ts": text(
      [
        600,
        n => `class C${n} {
  value = ${n};
  constructor() { this.first${n} = this.first${n}.bind(this); this.second${n} = this.second${n}.bind(this); }
  first${n}(): number { return this.value + 1; }
  second${n}(): number { return this.value * 2; }
}`,
      ],
      `let sum = 0;`,
      [600, n => `{ const c = new C${n}(); const f = c.first${n}, s = c.second${n}; sum += f() + s(); }`],
      `console.log(sum);
`,
    ),
    "closure-with-300-captures.ts": text(
      `// One closure refers to three hundred variables that three hundred other closures each refer to one of. However the captured variables are divided among environments, a closure holds a limited number of captures.
function make(seed: number) {
  const each: (() => number)[] = [];`,
      [
        300,
        n => `  const v${n} = seed + ${n};
  each.push(() => v${n});`,
      ],
      `  const all = () =>`,
      [
        29,
        n =>
          `    v${10 * n} + v${10 * n + 1} + v${10 * n + 2} + v${10 * n + 3} + v${10 * n + 4} + v${10 * n + 5} + v${10 * n + 6} + v${10 * n + 7} + v${10 * n + 8} + v${10 * n + 9} +`,
      ],
      `    v290 + v291 + v292 + v293 + v294 + v295 + v296 + v297 + v298 + v299;
  return { each, all };
}
function count(seed: number) {
  const bumps: (() => number)[] = [];`,
      [
        300,
        n => `  let c${n} = seed;
  bumps.push(() => ++c${n});`,
      ],
      `  const total = () =>`,
      [
        29,
        n =>
          `    c${10 * n} + c${10 * n + 1} + c${10 * n + 2} + c${10 * n + 3} + c${10 * n + 4} + c${10 * n + 5} + c${10 * n + 6} + c${10 * n + 7} + c${10 * n + 8} + c${10 * n + 9} +`,
      ],
      `    c290 + c291 + c292 + c293 + c294 + c295 + c296 + c297 + c298 + c299;
  return { bumps, total };
}
const made = make(1);
console.log(made.all(), made.each[0](), made.each[299](), made.each.reduce((sum, f) => sum + f(), 0));
const counted = count(0);
for (const bump of counted.bumps) bump();
counted.bumps[7]();
console.log(counted.total());
`,
    ),
    "display-names-of-many-functions.js": text(
      `// To name a frame by the \`displayName\` of its function the run time has to find the one closure of the function that runs, however many functions of the program are seen in stack traces or are given a \`displayName\`.`,
      [320, n => `function component${n}() { return new Error("x").stack; }`],
      `const all = [component0, component1, component2, component3, component4, component5, component6, component7, component8, component9, component10, component11, component12, component13, component14, component15, component16, component17, component18, component19, component20, component21, component22, component23, component24, component25, component26, component27, component28, component29, component30, component31, component32, component33, component34, component35, component36, component37, component38, component39, component40, component41, component42, component43, component44, component45, component46, component47, component48, component49, component50, component51, component52, component53, component54, component55, component56, component57, component58, component59, component60, component61, component62, component63, component64, component65, component66, component67, component68, component69, component70, component71, component72, component73, component74, component75, component76, component77, component78, component79, component80, component81, component82, component83, component84, component85, component86, component87, component88, component89, component90, component91, component92, component93, component94, component95, component96, component97, component98, component99, component100, component101, component102, component103, component104, component105, component106, component107, component108, component109, component110, component111, component112, component113, component114, component115, component116, component117, component118, component119, component120, component121, component122, component123, component124, component125, component126, component127, component128, component129, component130, component131, component132, component133, component134, component135, component136, component137, component138, component139, component140, component141, component142, component143, component144, component145, component146, component147, component148, component149, component150, component151, component152, component153, component154, component155, component156, component157, component158, component159, component160, component161, component162, component163, component164, component165, component166, component167, component168, component169, component170, component171, component172, component173, component174, component175, component176, component177, component178, component179, component180, component181, component182, component183, component184, component185, component186, component187, component188, component189, component190, component191, component192, component193, component194, component195, component196, component197, component198, component199, component200, component201, component202, component203, component204, component205, component206, component207, component208, component209, component210, component211, component212, component213, component214, component215, component216, component217, component218, component219, component220, component221, component222, component223, component224, component225, component226, component227, component228, component229, component230, component231, component232, component233, component234, component235, component236, component237, component238, component239, component240, component241, component242, component243, component244, component245, component246, component247, component248, component249, component250, component251, component252, component253, component254, component255, component256, component257, component258, component259, component260, component261, component262, component263, component264, component265, component266, component267, component268, component269, component270, component271, component272, component273, component274, component275, component276, component277, component278, component279, component280, component281, component282, component283, component284, component285, component286, component287, component288, component289, component290, component291, component292, component293, component294, component295, component296, component297, component298, component299, component300, component301, component302, component303, component304, component305, component306, component307, component308, component309, component310, component311, component312, component313, component314, component315, component316, component317, component318, component319];
const shown = (from, to, text) => { let n = 0; for (let i = from; i < to; i++) n += all[i]().includes(text + i + " ") || all[i]().includes(text + i + "@") || all[i]().includes(text + i + "\\n") ? 1 : 0; return n; };
console.log(all.length, "functions; by their written names:", shown(0, 20, "component"));
component0.displayName = "Shown0";
console.log("one has a displayName:", shown(0, 1, "Shown"), "the others keep their names:", shown(1, 20, "component"));
console.log("seen again:", shown(0, 1, "Shown"), shown(1, 20, "component"));
function give(f, name) { f.displayName = name; }
for (let i = 0; i < all.length; i++) give(all[i], "Shown" + i);
console.log("all have a displayName, stored at one place:", shown(0, all.length, "Shown"));
`,
    ),
    "functions-nested-three-hundred-deep.js": text(
      `// A closure has room for 255 captures. Each of these functions reaches more scopes than that.
const lines = [];
// Parameters that nothing stores to: copies.`,
      [301, n => `function p${n}(a${n}) {`],
      `return a0 + a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8 + a9 + a10 + a11 + a12 + a13 + a14 + a15 + a16 + a17 + a18 + a19 + a20 + a21 + a22 + a23 + a24 + a25 + a26 + a27 + a28 + a29 + a30 + a31 + a32 + a33 + a34 + a35 + a36 + a37 + a38 + a39 + a40 + a41 + a42 + a43 + a44 + a45 + a46 + a47 + a48 + a49 + a50 + a51 + a52 + a53 + a54 + a55 + a56 + a57 + a58 + a59 + a60 + a61 + a62 + a63 + a64 + a65 + a66 + a67 + a68 + a69 + a70 + a71 + a72 + a73 + a74 + a75 + a76 + a77 + a78 + a79 + a80 + a81 + a82 + a83 + a84 + a85 + a86 + a87 + a88 + a89 + a90 + a91 + a92 + a93 + a94 + a95 + a96 + a97 + a98 + a99 + a100 + a101 + a102 + a103 + a104 + a105 + a106 + a107 + a108 + a109 + a110 + a111 + a112 + a113 + a114 + a115 + a116 + a117 + a118 + a119 + a120 + a121 + a122 + a123 + a124 + a125 + a126 + a127 + a128 + a129 + a130 + a131 + a132 + a133 + a134 + a135 + a136 + a137 + a138 + a139 + a140 + a141 + a142 + a143 + a144 + a145 + a146 + a147 + a148 + a149 + a150 + a151 + a152 + a153 + a154 + a155 + a156 + a157 + a158 + a159 + a160 + a161 + a162 + a163 + a164 + a165 + a166 + a167 + a168 + a169 + a170 + a171 + a172 + a173 + a174 + a175 + a176 + a177 + a178 + a179 + a180 + a181 + a182 + a183 + a184 + a185 + a186 + a187 + a188 + a189 + a190 + a191 + a192 + a193 + a194 + a195 + a196 + a197 + a198 + a199 + a200 + a201 + a202 + a203 + a204 + a205 + a206 + a207 + a208 + a209 + a210 + a211 + a212 + a213 + a214 + a215 + a216 + a217 + a218 + a219 + a220 + a221 + a222 + a223 + a224 + a225 + a226 + a227 + a228 + a229 + a230 + a231 + a232 + a233 + a234 + a235 + a236 + a237 + a238 + a239 + a240 + a241 + a242 + a243 + a244 + a245 + a246 + a247 + a248 + a249 + a250 + a251 + a252 + a253 + a254 + a255 + a256 + a257 + a258 + a259 + a260 + a261 + a262 + a263 + a264 + a265 + a266 + a267 + a268 + a269 + a270 + a271 + a272 + a273 + a274 + a275 + a276 + a277 + a278 + a279 + a280 + a281 + a282 + a283 + a284 + a285 + a286 + a287 + a288 + a289 + a290 + a291 + a292 + a293 + a294 + a295 + a296 + a297 + a298 + a299 + a300;`,
      [
        300,
        n => `}
return p${300 - n}(a${299 - n} + 1);`,
      ],
      `}
lines.push(p0(1));
// Variables that the innermost function stores to: an environment a scope.`,
      [
        301,
        n => `function m${n}() {
let v${n} = ${n};`,
      ],
      `v0++;v1++;v2++;v3++;v4++;v5++;v6++;v7++;v8++;v9++;v10++;v11++;v12++;v13++;v14++;v15++;v16++;v17++;v18++;v19++;v20++;v21++;v22++;v23++;v24++;v25++;v26++;v27++;v28++;v29++;v30++;v31++;v32++;v33++;v34++;v35++;v36++;v37++;v38++;v39++;v40++;v41++;v42++;v43++;v44++;v45++;v46++;v47++;v48++;v49++;v50++;v51++;v52++;v53++;v54++;v55++;v56++;v57++;v58++;v59++;v60++;v61++;v62++;v63++;v64++;v65++;v66++;v67++;v68++;v69++;v70++;v71++;v72++;v73++;v74++;v75++;v76++;v77++;v78++;v79++;v80++;v81++;v82++;v83++;v84++;v85++;v86++;v87++;v88++;v89++;v90++;v91++;v92++;v93++;v94++;v95++;v96++;v97++;v98++;v99++;v100++;v101++;v102++;v103++;v104++;v105++;v106++;v107++;v108++;v109++;v110++;v111++;v112++;v113++;v114++;v115++;v116++;v117++;v118++;v119++;v120++;v121++;v122++;v123++;v124++;v125++;v126++;v127++;v128++;v129++;v130++;v131++;v132++;v133++;v134++;v135++;v136++;v137++;v138++;v139++;v140++;v141++;v142++;v143++;v144++;v145++;v146++;v147++;v148++;v149++;v150++;v151++;v152++;v153++;v154++;v155++;v156++;v157++;v158++;v159++;v160++;v161++;v162++;v163++;v164++;v165++;v166++;v167++;v168++;v169++;v170++;v171++;v172++;v173++;v174++;v175++;v176++;v177++;v178++;v179++;v180++;v181++;v182++;v183++;v184++;v185++;v186++;v187++;v188++;v189++;v190++;v191++;v192++;v193++;v194++;v195++;v196++;v197++;v198++;v199++;v200++;v201++;v202++;v203++;v204++;v205++;v206++;v207++;v208++;v209++;v210++;v211++;v212++;v213++;v214++;v215++;v216++;v217++;v218++;v219++;v220++;v221++;v222++;v223++;v224++;v225++;v226++;v227++;v228++;v229++;v230++;v231++;v232++;v233++;v234++;v235++;v236++;v237++;v238++;v239++;v240++;v241++;v242++;v243++;v244++;v245++;v246++;v247++;v248++;v249++;v250++;v251++;v252++;v253++;v254++;v255++;v256++;v257++;v258++;v259++;v260++;v261++;v262++;v263++;v264++;v265++;v266++;v267++;v268++;v269++;v270++;v271++;v272++;v273++;v274++;v275++;v276++;v277++;v278++;v279++;v280++;v281++;v282++;v283++;v284++;v285++;v286++;v287++;v288++;v289++;v290++;v291++;v292++;v293++;v294++;v295++;v296++;v297++;v298++;v299++;v300++;
return 0;`,
      [
        300,
        n => `}
return m${300 - n}() + v${299 - n};`,
      ],
      `}
lines.push(m0());
// What the innermost function makes: an arrow, a generator, an async function, a method that names \`super\`, closures of a loop.`,
      [261, n => `function k${n}(b${n}) {`],
      `const arrow = () => b0 + b1 + b2 + b3 + b4 + b5 + b6 + b7 + b8 + b9 + b10 + b11 + b12 + b13 + b14 + b15 + b16 + b17 + b18 + b19 + b20 + b21 + b22 + b23 + b24 + b25 + b26 + b27 + b28 + b29 + b30 + b31 + b32 + b33 + b34 + b35 + b36 + b37 + b38 + b39 + b40 + b41 + b42 + b43 + b44 + b45 + b46 + b47 + b48 + b49 + b50 + b51 + b52 + b53 + b54 + b55 + b56 + b57 + b58 + b59 + b60 + b61 + b62 + b63 + b64 + b65 + b66 + b67 + b68 + b69 + b70 + b71 + b72 + b73 + b74 + b75 + b76 + b77 + b78 + b79 + b80 + b81 + b82 + b83 + b84 + b85 + b86 + b87 + b88 + b89 + b90 + b91 + b92 + b93 + b94 + b95 + b96 + b97 + b98 + b99 + b100 + b101 + b102 + b103 + b104 + b105 + b106 + b107 + b108 + b109 + b110 + b111 + b112 + b113 + b114 + b115 + b116 + b117 + b118 + b119 + b120 + b121 + b122 + b123 + b124 + b125 + b126 + b127 + b128 + b129 + b130 + b131 + b132 + b133 + b134 + b135 + b136 + b137 + b138 + b139 + b140 + b141 + b142 + b143 + b144 + b145 + b146 + b147 + b148 + b149 + b150 + b151 + b152 + b153 + b154 + b155 + b156 + b157 + b158 + b159 + b160 + b161 + b162 + b163 + b164 + b165 + b166 + b167 + b168 + b169 + b170 + b171 + b172 + b173 + b174 + b175 + b176 + b177 + b178 + b179 + b180 + b181 + b182 + b183 + b184 + b185 + b186 + b187 + b188 + b189 + b190 + b191 + b192 + b193 + b194 + b195 + b196 + b197 + b198 + b199 + b200 + b201 + b202 + b203 + b204 + b205 + b206 + b207 + b208 + b209 + b210 + b211 + b212 + b213 + b214 + b215 + b216 + b217 + b218 + b219 + b220 + b221 + b222 + b223 + b224 + b225 + b226 + b227 + b228 + b229 + b230 + b231 + b232 + b233 + b234 + b235 + b236 + b237 + b238 + b239 + b240 + b241 + b242 + b243 + b244 + b245 + b246 + b247 + b248 + b249 + b250 + b251 + b252 + b253 + b254 + b255 + b256 + b257 + b258 + b259 + b260;
function* generator() { yield b0 + b1 + b2 + b3 + b4 + b5 + b6 + b7 + b8 + b9 + b10 + b11 + b12 + b13 + b14 + b15 + b16 + b17 + b18 + b19 + b20 + b21 + b22 + b23 + b24 + b25 + b26 + b27 + b28 + b29 + b30 + b31 + b32 + b33 + b34 + b35 + b36 + b37 + b38 + b39 + b40 + b41 + b42 + b43 + b44 + b45 + b46 + b47 + b48 + b49 + b50 + b51 + b52 + b53 + b54 + b55 + b56 + b57 + b58 + b59 + b60 + b61 + b62 + b63 + b64 + b65 + b66 + b67 + b68 + b69 + b70 + b71 + b72 + b73 + b74 + b75 + b76 + b77 + b78 + b79 + b80 + b81 + b82 + b83 + b84 + b85 + b86 + b87 + b88 + b89 + b90 + b91 + b92 + b93 + b94 + b95 + b96 + b97 + b98 + b99 + b100 + b101 + b102 + b103 + b104 + b105 + b106 + b107 + b108 + b109 + b110 + b111 + b112 + b113 + b114 + b115 + b116 + b117 + b118 + b119 + b120 + b121 + b122 + b123 + b124 + b125 + b126 + b127 + b128 + b129 + b130 + b131 + b132 + b133 + b134 + b135 + b136 + b137 + b138 + b139 + b140 + b141 + b142 + b143 + b144 + b145 + b146 + b147 + b148 + b149 + b150 + b151 + b152 + b153 + b154 + b155 + b156 + b157 + b158 + b159 + b160 + b161 + b162 + b163 + b164 + b165 + b166 + b167 + b168 + b169 + b170 + b171 + b172 + b173 + b174 + b175 + b176 + b177 + b178 + b179 + b180 + b181 + b182 + b183 + b184 + b185 + b186 + b187 + b188 + b189 + b190 + b191 + b192 + b193 + b194 + b195 + b196 + b197 + b198 + b199 + b200 + b201 + b202 + b203 + b204 + b205 + b206 + b207 + b208 + b209 + b210 + b211 + b212 + b213 + b214 + b215 + b216 + b217 + b218 + b219 + b220 + b221 + b222 + b223 + b224 + b225 + b226 + b227 + b228 + b229 + b230 + b231 + b232 + b233 + b234 + b235 + b236 + b237 + b238 + b239 + b240 + b241 + b242 + b243 + b244 + b245 + b246 + b247 + b248 + b249 + b250 + b251 + b252 + b253 + b254 + b255 + b256 + b257 + b258 + b259 + b260; yield b0 + b260; }
async function later() { await null; return b0 + b1 + b2 + b3 + b4 + b5 + b6 + b7 + b8 + b9 + b10 + b11 + b12 + b13 + b14 + b15 + b16 + b17 + b18 + b19 + b20 + b21 + b22 + b23 + b24 + b25 + b26 + b27 + b28 + b29 + b30 + b31 + b32 + b33 + b34 + b35 + b36 + b37 + b38 + b39 + b40 + b41 + b42 + b43 + b44 + b45 + b46 + b47 + b48 + b49 + b50 + b51 + b52 + b53 + b54 + b55 + b56 + b57 + b58 + b59 + b60 + b61 + b62 + b63 + b64 + b65 + b66 + b67 + b68 + b69 + b70 + b71 + b72 + b73 + b74 + b75 + b76 + b77 + b78 + b79 + b80 + b81 + b82 + b83 + b84 + b85 + b86 + b87 + b88 + b89 + b90 + b91 + b92 + b93 + b94 + b95 + b96 + b97 + b98 + b99 + b100 + b101 + b102 + b103 + b104 + b105 + b106 + b107 + b108 + b109 + b110 + b111 + b112 + b113 + b114 + b115 + b116 + b117 + b118 + b119 + b120 + b121 + b122 + b123 + b124 + b125 + b126 + b127 + b128 + b129 + b130 + b131 + b132 + b133 + b134 + b135 + b136 + b137 + b138 + b139 + b140 + b141 + b142 + b143 + b144 + b145 + b146 + b147 + b148 + b149 + b150 + b151 + b152 + b153 + b154 + b155 + b156 + b157 + b158 + b159 + b160 + b161 + b162 + b163 + b164 + b165 + b166 + b167 + b168 + b169 + b170 + b171 + b172 + b173 + b174 + b175 + b176 + b177 + b178 + b179 + b180 + b181 + b182 + b183 + b184 + b185 + b186 + b187 + b188 + b189 + b190 + b191 + b192 + b193 + b194 + b195 + b196 + b197 + b198 + b199 + b200 + b201 + b202 + b203 + b204 + b205 + b206 + b207 + b208 + b209 + b210 + b211 + b212 + b213 + b214 + b215 + b216 + b217 + b218 + b219 + b220 + b221 + b222 + b223 + b224 + b225 + b226 + b227 + b228 + b229 + b230 + b231 + b232 + b233 + b234 + b235 + b236 + b237 + b238 + b239 + b240 + b241 + b242 + b243 + b244 + b245 + b246 + b247 + b248 + b249 + b250 + b251 + b252 + b253 + b254 + b255 + b256 + b257 + b258 + b259 + b260; }
const object = { __proto__: { m() { return 1000000; } }, m() { return super.m() + b0 + b1 + b2 + b3 + b4 + b5 + b6 + b7 + b8 + b9 + b10 + b11 + b12 + b13 + b14 + b15 + b16 + b17 + b18 + b19 + b20 + b21 + b22 + b23 + b24 + b25 + b26 + b27 + b28 + b29 + b30 + b31 + b32 + b33 + b34 + b35 + b36 + b37 + b38 + b39 + b40 + b41 + b42 + b43 + b44 + b45 + b46 + b47 + b48 + b49 + b50 + b51 + b52 + b53 + b54 + b55 + b56 + b57 + b58 + b59 + b60 + b61 + b62 + b63 + b64 + b65 + b66 + b67 + b68 + b69 + b70 + b71 + b72 + b73 + b74 + b75 + b76 + b77 + b78 + b79 + b80 + b81 + b82 + b83 + b84 + b85 + b86 + b87 + b88 + b89 + b90 + b91 + b92 + b93 + b94 + b95 + b96 + b97 + b98 + b99 + b100 + b101 + b102 + b103 + b104 + b105 + b106 + b107 + b108 + b109 + b110 + b111 + b112 + b113 + b114 + b115 + b116 + b117 + b118 + b119 + b120 + b121 + b122 + b123 + b124 + b125 + b126 + b127 + b128 + b129 + b130 + b131 + b132 + b133 + b134 + b135 + b136 + b137 + b138 + b139 + b140 + b141 + b142 + b143 + b144 + b145 + b146 + b147 + b148 + b149 + b150 + b151 + b152 + b153 + b154 + b155 + b156 + b157 + b158 + b159 + b160 + b161 + b162 + b163 + b164 + b165 + b166 + b167 + b168 + b169 + b170 + b171 + b172 + b173 + b174 + b175 + b176 + b177 + b178 + b179 + b180 + b181 + b182 + b183 + b184 + b185 + b186 + b187 + b188 + b189 + b190 + b191 + b192 + b193 + b194 + b195 + b196 + b197 + b198 + b199 + b200 + b201 + b202 + b203 + b204 + b205 + b206 + b207 + b208 + b209 + b210 + b211 + b212 + b213 + b214 + b215 + b216 + b217 + b218 + b219 + b220 + b221 + b222 + b223 + b224 + b225 + b226 + b227 + b228 + b229 + b230 + b231 + b232 + b233 + b234 + b235 + b236 + b237 + b238 + b239 + b240 + b241 + b242 + b243 + b244 + b245 + b246 + b247 + b248 + b249 + b250 + b251 + b252 + b253 + b254 + b255 + b256 + b257 + b258 + b259 + b260; } };
const made = [];
for (let round = 0; round < 3; round++) made.push(function () { return round + b0 + b1 + b2 + b3 + b4 + b5 + b6 + b7 + b8 + b9 + b10 + b11 + b12 + b13 + b14 + b15 + b16 + b17 + b18 + b19 + b20 + b21 + b22 + b23 + b24 + b25 + b26 + b27 + b28 + b29 + b30 + b31 + b32 + b33 + b34 + b35 + b36 + b37 + b38 + b39 + b40 + b41 + b42 + b43 + b44 + b45 + b46 + b47 + b48 + b49 + b50 + b51 + b52 + b53 + b54 + b55 + b56 + b57 + b58 + b59 + b60 + b61 + b62 + b63 + b64 + b65 + b66 + b67 + b68 + b69 + b70 + b71 + b72 + b73 + b74 + b75 + b76 + b77 + b78 + b79 + b80 + b81 + b82 + b83 + b84 + b85 + b86 + b87 + b88 + b89 + b90 + b91 + b92 + b93 + b94 + b95 + b96 + b97 + b98 + b99 + b100 + b101 + b102 + b103 + b104 + b105 + b106 + b107 + b108 + b109 + b110 + b111 + b112 + b113 + b114 + b115 + b116 + b117 + b118 + b119 + b120 + b121 + b122 + b123 + b124 + b125 + b126 + b127 + b128 + b129 + b130 + b131 + b132 + b133 + b134 + b135 + b136 + b137 + b138 + b139 + b140 + b141 + b142 + b143 + b144 + b145 + b146 + b147 + b148 + b149 + b150 + b151 + b152 + b153 + b154 + b155 + b156 + b157 + b158 + b159 + b160 + b161 + b162 + b163 + b164 + b165 + b166 + b167 + b168 + b169 + b170 + b171 + b172 + b173 + b174 + b175 + b176 + b177 + b178 + b179 + b180 + b181 + b182 + b183 + b184 + b185 + b186 + b187 + b188 + b189 + b190 + b191 + b192 + b193 + b194 + b195 + b196 + b197 + b198 + b199 + b200 + b201 + b202 + b203 + b204 + b205 + b206 + b207 + b208 + b209 + b210 + b211 + b212 + b213 + b214 + b215 + b216 + b217 + b218 + b219 + b220 + b221 + b222 + b223 + b224 + b225 + b226 + b227 + b228 + b229 + b230 + b231 + b232 + b233 + b234 + b235 + b236 + b237 + b238 + b239 + b240 + b241 + b242 + b243 + b244 + b245 + b246 + b247 + b248 + b249 + b250 + b251 + b252 + b253 + b254 + b255 + b256 + b257 + b258 + b259 + b260; });
later().then(value => console.log("later", value));
return [arrow(), ...generator(), object.m(), ...made.map(each => each())].join();`,
      [
        260,
        n => `}
return k${260 - n}(b${259 - n} + 1);`,
      ],
      `}
lines.push(k0(1));
// The closure outlives the calls that made it, and each call makes its own.`,
      [261, n => `function h${n}(c${n}) {`],
      `return function () { return c0 + c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8 + c9 + c10 + c11 + c12 + c13 + c14 + c15 + c16 + c17 + c18 + c19 + c20 + c21 + c22 + c23 + c24 + c25 + c26 + c27 + c28 + c29 + c30 + c31 + c32 + c33 + c34 + c35 + c36 + c37 + c38 + c39 + c40 + c41 + c42 + c43 + c44 + c45 + c46 + c47 + c48 + c49 + c50 + c51 + c52 + c53 + c54 + c55 + c56 + c57 + c58 + c59 + c60 + c61 + c62 + c63 + c64 + c65 + c66 + c67 + c68 + c69 + c70 + c71 + c72 + c73 + c74 + c75 + c76 + c77 + c78 + c79 + c80 + c81 + c82 + c83 + c84 + c85 + c86 + c87 + c88 + c89 + c90 + c91 + c92 + c93 + c94 + c95 + c96 + c97 + c98 + c99 + c100 + c101 + c102 + c103 + c104 + c105 + c106 + c107 + c108 + c109 + c110 + c111 + c112 + c113 + c114 + c115 + c116 + c117 + c118 + c119 + c120 + c121 + c122 + c123 + c124 + c125 + c126 + c127 + c128 + c129 + c130 + c131 + c132 + c133 + c134 + c135 + c136 + c137 + c138 + c139 + c140 + c141 + c142 + c143 + c144 + c145 + c146 + c147 + c148 + c149 + c150 + c151 + c152 + c153 + c154 + c155 + c156 + c157 + c158 + c159 + c160 + c161 + c162 + c163 + c164 + c165 + c166 + c167 + c168 + c169 + c170 + c171 + c172 + c173 + c174 + c175 + c176 + c177 + c178 + c179 + c180 + c181 + c182 + c183 + c184 + c185 + c186 + c187 + c188 + c189 + c190 + c191 + c192 + c193 + c194 + c195 + c196 + c197 + c198 + c199 + c200 + c201 + c202 + c203 + c204 + c205 + c206 + c207 + c208 + c209 + c210 + c211 + c212 + c213 + c214 + c215 + c216 + c217 + c218 + c219 + c220 + c221 + c222 + c223 + c224 + c225 + c226 + c227 + c228 + c229 + c230 + c231 + c232 + c233 + c234 + c235 + c236 + c237 + c238 + c239 + c240 + c241 + c242 + c243 + c244 + c245 + c246 + c247 + c248 + c249 + c250 + c251 + c252 + c253 + c254 + c255 + c256 + c257 + c258 + c259 + c260; };`,
      [
        260,
        n => `}
return h${260 - n}(c${259 - n} * 1 + 1);`,
      ],
      `}
const first = h0(1), second = h0(1000);
lines.push(first(), second(), first());
console.log(lines.join("\\n"));
`,
    ),
    "large-closure.ts": text(
      `// Generated: one closure captures 8,700 constants.
function add(list: number[]): number {
    let t = 0;
    for (const n of list)
        t += n;
    return t;
}
function churn(): number {
    let n = 0;
    for (let i = 0; i < 400; i++) {
        const list: { x: number, y: string }[] = [];
        for (let j = 0; j < 10000; j++)
            list.push({ x: j, y: "g" + j });
        n += list.length;
    }
    return n;
}
const one = Number("1");
function make(): () => number {`,
      [8300, n => `    const n${n} = ${n} + 0.5;`],
      [
        200,
        n => `    const o${2 * n + 8300} = { x: ${2 * n + 8300} };
    const s${2 * n + 8301} = "s" + (${2 * n + 8301} + one);`,
      ],
      `    return () => {
        return add([`,
      [8300, n => `            n${n},`],
      [
        200,
        n => `            o${2 * n + 8300}.x,
            s${2 * n + 8301}.length,`,
      ],
      `        ]);
    };
}
const a = make(), b = make();
console.log(a());
console.log(churn());
console.log(a(), b());
`,
    ),
    "large-constructor.ts": text(
      `// Generated: a constructor that initializes thousands of fields.
interface Many {
    o: number[];`,
      [5000, n => `    f${n}: number;`],
      `}
function ManyImpl(this: Many, o: number[], k: number) {
    this.o = o;`,
      [
        2500,
        n => `    this.f${2 * n} = ${2 * n};
    this.f${2 * n + 1} = k;`,
      ],
      `}
const ManyConstructor = ManyImpl as unknown as new (o: number[], k: number) => Many;
const shared = [1];
const list: Many[] = [];
for (let i = 0; i < 3; i++)
    list.push(new ManyConstructor(shared, i));
const keys = Object.keys(list[2]);
console.log(keys.length, keys[0], keys[4094], keys[4095], keys[4096], keys[5000], list[2].f0, list[2].f4093, list[2].f4094, list[2].f4095, list[2].f4998, list[2].f4999);
`,
    ),
    "large-environment.ts": text(
      `// Generated: 8,700 captured variables in one function, more than 64 KB.
function add(list: number[]): number {
    let t = 0;
    for (const n of list)
        t += n;
    return t;
}
function churn(): number {
    let n = 0;
    for (let i = 0; i < 400; i++) {
        const list: { x: number, y: string }[] = [];
        for (let j = 0; j < 10000; j++)
            list.push({ x: j, y: "g" + j });
        n += list.length;
    }
    return n;
}
const one = Number("1");
function make() {`,
      [8300, n => `    let n${n} = ${n} + 0.5;`],
      [
        200,
        n => `    let o${2 * n + 8300} = { x: ${2 * n + 8300} };
    let s${2 * n + 8301} = "s" + (${2 * n + 8301} + one);`,
      ],
      `    return {
        sum(): number {
            return add([`,
      [8300, n => `                n${n},`],
      [
        200,
        n => `                o${2 * n + 8300}.x,
                s${2 * n + 8301}.length,`,
      ],
      `            ]);
        },
        bump(): void {`,
      [8300, n => `            n${n} += 1;`],
      [
        200,
        n => `            o${2 * n + 8300} = { x: o${2 * n + 8300}.x + 1 };
            s${2 * n + 8301} += "!";`,
      ],
      `        },
    };
}
const a = make(), b = make();
console.log(a.sum());
console.log(churn());
console.log(a.sum());
a.bump();
console.log(churn());
console.log(a.sum(), b.sum());
`,
    ),
    "large-module.ts": text(
      `// Generated: a module with 8,700 top-level variables.
function add(list: number[]): number {
    let t = 0;
    for (const n of list)
        t += n;
    return t;
}
function churn(): number {
    let n = 0;
    for (let i = 0; i < 400; i++) {
        const list: { x: number, y: string }[] = [];
        for (let j = 0; j < 10000; j++)
            list.push({ x: j, y: "g" + j });
        n += list.length;
    }
    return n;
}
const one = Number("1");`,
      [8300, n => `let n${n} = ${n} + 0.5;`],
      [
        200,
        n => `let o${2 * n + 8300} = { x: ${2 * n + 8300} };
let s${2 * n + 8301} = "s" + (${2 * n + 8301} + one);`,
      ],
      `function sum(): number {
    return add([`,
      [8300, n => `        n${n},`],
      [
        200,
        n => `        o${2 * n + 8300}.x,
        s${2 * n + 8301}.length,`,
      ],
      `    ]);
}
function bump(): void {`,
      [8300, n => `    n${n} += 1;`],
      [
        200,
        n => `    o${2 * n + 8300} = { x: o${2 * n + 8300}.x + 1 };
    s${2 * n + 8301} += "!";`,
      ],
      `}
console.log(sum());
console.log(churn());
console.log(sum());
bump();
console.log(churn());
console.log(sum());
`,
    ),
    "large-object.ts": text(
      `// Generated: a class and an object type with 8,700 fields, so objects of more than 64 KB.
function add(list: number[]): number {
    let t = 0;
    for (const n of list)
        t += n;
    return t;
}
function churn(): number {
    let n = 0;
    for (let i = 0; i < 400; i++) {
        const list: { x: number, y: string }[] = [];
        for (let j = 0; j < 10000; j++)
            list.push({ x: j, y: "g" + j });
        n += list.length;
    }
    return n;
}
function keysOf(o: object): string {
    const keys = Object.keys(o);
    let inOrder = 0;
    for (const key in o)
        inOrder += key === keys[inOrder] ? 1 : 0;
    return keys.length + " " + inOrder + " " + keys[0] + " " + keys[4094] + " " + keys[4095] + " " + keys[4096] + " " + keys[keys.length - 1];
}
const one = Number("1");
class Large {`,
      [8300, n => `    n${n}: number;`],
      [
        200,
        n => `    o${2 * n + 8300}: { x: number };
    s${2 * n + 8301}: string;`,
      ],
      `    constructor() {`,
      [8300, n => `        this.n${n} = ${n} + 0.5;`],
      [
        200,
        n => `        this.o${2 * n + 8300} = { x: ${2 * n + 8300} };
        this.s${2 * n + 8301} = "s" + (${2 * n + 8301} + one);`,
      ],
      `    }
    sum(): number {
        return add([`,
      [8300, n => `            this.n${n},`],
      [
        200,
        n => `            this.o${2 * n + 8300}.x,
            this.s${2 * n + 8301}.length,`,
      ],
      `        ]);
    }
    bump(): void {`,
      [8300, n => `        this.n${n} += 1;`],
      [
        200,
        n => `        this.o${2 * n + 8300} = { x: this.o${2 * n + 8300}.x + 1 };
        this.s${2 * n + 8301} += "!";`,
      ],
      `    }
}
function record() {
    return {`,
      [8300, n => `        n${n}: ${n} + 0.5,`],
      [
        200,
        n => `        o${2 * n + 8300}: { x: ${2 * n + 8300} },
        s${2 * n + 8301}: "s" + (${2 * n + 8301} + one),`,
      ],
      `    };
}
function sumOf(r: ReturnType<typeof record>): number {
    return add([`,
      [8300, n => `        r.n${n},`],
      [
        200,
        n => `        r.o${2 * n + 8300}.x,
        r.s${2 * n + 8301}.length,`,
      ],
      `    ]);
}
const a = new Large(), b = new Large(), r = record();
console.log(a.sum());
console.log(churn());
console.log(a.sum());
a.bump();
console.log(churn());
console.log(a.sum(), b.sum());
console.log(sumOf(r), keysOf(a), keysOf(r));
r.o8300 = { x: -1 };
r.s8699 = "";
console.log(churn());
console.log(sumOf(r), JSON.stringify(a).length, JSON.stringify(r).length);
`,
    ),
    "objects-of-about-4095-functions-over-the-variables-around-them.js": text(
      `// Generated: object literals of 4,094, 4,095 and 4,200 functions that read a variable of the function around them, which runs more than once.
function makeMethods(start) {
    let captured = start;
    const object = {`,
      [4094, n => `        member${n}() { return captured + ${n}; },`],
      `    };
    captured++;
    return object;
}
function makeFunctions(start) {
    let captured = start;
    const object = {`,
      [4095, n => `        member${n}: function () { return captured + ${n}; },`],
      `    };
    captured++;
    return object;
}
function makeArrowFunctions(start) {
    let captured = start;
    const object = {`,
      [4200, n => `        member${n}: () => captured + ${n},`],
      `    };
    captured++;
    return object;
}
for (const start of [1, 10]) {
    const methods = makeMethods(start);
    console.log(Object.keys(methods).length, methods.member0(), methods.member2047(), methods.member4093());
    const functions = makeFunctions(start);
    console.log(Object.keys(functions).length, functions.member0(), functions.member2047(), functions.member4094());
    const arrowFunctions = makeArrowFunctions(start);
    console.log(Object.keys(arrowFunctions).length, arrowFunctions.member0(), arrowFunctions.member2047(), arrowFunctions.member4199());
}
`,
    ),
    "more-guarded-members-than-one-word-of-bits.js": text(
      `const stored = [];
function Record(seed) {`,
      [150, n => `  this.field${n} = seed + ${n};`],
      `}`,
      [150, n => `Record.prototype.method${n} = function () { return this.field${n} * 2; };`],
      `
class Shape {
  constructor(seed) {`,
      [150, n => `    this.side${n} = seed - ${n};`],
      `  }`,
      [150, n => `  measure${n}() { return this.side${n} + 1; }`],
      `}

function sumOfRecord(record) {
  let sum = 0;`,
      [150, n => `  sum += record.method${n}();`],
      `  return sum;
}
function sumOfShape(shape) {
  let sum = 0;`,
      [150, n => `  sum += shape.measure${n}();`],
      `  return sum;
}
function round(label) {
  let total = 0;
  for (let i = 0; i < 50; i++) total += sumOfRecord(new Record(i)) + sumOfShape(new Shape(i));
  console.log(label, total);
}

round("untouched");`,
      [
        2,
        n => `Record.prototype.method${65 * n} = function () { return 1000000 + ${65 * n}; };
round("method${65 * n} replaced");
Shape.prototype.measure${65 * n} = function () { return 2000000 + ${65 * n}; };
round("measure${65 * n} replaced");
Record.prototype.method${64 * n + 63} = function () { return 1000000 + ${64 * n + 63}; };
round("method${64 * n + 63} replaced");
Shape.prototype.measure${64 * n + 63} = function () { return 2000000 + ${64 * n + 63}; };
round("measure${64 * n + 63} replaced");
Record.prototype.method${64 * n + 64} = function () { return 1000000 + ${64 * n + 64}; };
round("method${64 * n + 64} replaced");
Shape.prototype.measure${64 * n + 64} = function () { return 2000000 + ${64 * n + 64}; };
round("measure${64 * n + 64} replaced");`,
      ],
      `Record.prototype.method149 = function () { return 1000000 + 149; };
round("method149 replaced");
Shape.prototype.measure149 = function () { return 2000000 + 149; };
round("measure149 replaced");`,
      [
        2,
        n => `Object.defineProperty(Record.prototype, "field${125 * n + 1}", { set(value) { stored.push("field${125 * n + 1}", value); }, get() { return -${125 * n + 1}; }, configurable: true });
round("field${125 * n + 1} is an accessor of the prototype"); console.log(stored.length, stored[stored.length - 1]);
Object.defineProperty(Shape.prototype, "side${125 * n + 1}", { set(value) { stored.push("side${125 * n + 1}", value); }, get() { return -${125 * n + 1}; }, configurable: true });
round("side${125 * n + 1} is an accessor of the prototype"); console.log(stored.length, stored[stored.length - 1]);
Object.defineProperty(Record.prototype, "field${68 * n + 62}", { set(value) { stored.push("field${68 * n + 62}", value); }, get() { return -${68 * n + 62}; }, configurable: true });
round("field${68 * n + 62} is an accessor of the prototype"); console.log(stored.length, stored[stored.length - 1]);
Object.defineProperty(Shape.prototype, "side${68 * n + 62}", { set(value) { stored.push("side${68 * n + 62}", value); }, get() { return -${68 * n + 62}; }, configurable: true });
round("side${68 * n + 62} is an accessor of the prototype"); console.log(stored.length, stored[stored.length - 1]);
Object.defineProperty(Record.prototype, "field${82 * n + 66}", { set(value) { stored.push("field${82 * n + 66}", value); }, get() { return -${82 * n + 66}; }, configurable: true });
round("field${82 * n + 66} is an accessor of the prototype"); console.log(stored.length, stored[stored.length - 1]);
Object.defineProperty(Shape.prototype, "side${82 * n + 66}", { set(value) { stored.push("side${82 * n + 66}", value); }, get() { return -${82 * n + 66}; }, configurable: true });
round("side${82 * n + 66} is an accessor of the prototype"); console.log(stored.length, stored[stored.length - 1]);`,
      ],
      `const hidden = new Record(7);
hidden.method2 = function () { return 3000000 + 2; };
hidden.method67 = function () { return 3000000 + 67; };
hidden.method131 = function () { return 3000000 + 131; };
console.log("own methods hide the class's", sumOfRecord(hidden), sumOfRecord(new Record(7)));
Object.setPrototypeOf(Shape.prototype, { measure3() { return 5; }, extra() { return 6; } });
delete Shape.prototype.measure140;
try { round("measure140 deleted"); } catch (error) { console.log(error instanceof TypeError); }
`,
    ),
  });
