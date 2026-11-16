// COUNT: operation:operationAOTGetByIdAndCache <= 400
// `if (fn.length > 3)`: a router asks each of its handlers at every request (router/lib/layer.js: three or four times a request of express, 1,480 instructions).
// What was filed for the length of a compiled function only said that the function has one, and every read came to the run time: 655 instructions. The length that a function is written with lies in a table of the image.
function three(a, b, c) { return a; }
function withDefault(a, b = 1, c) { return a; }
function withRest(a, b, ...rest) { return a; }
const holder = {
  run(a, b) { return this; },
  get size() { return 1; },
  async later(a) {},
  *each(a, b, c, d) {},
};
function many(a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, b0, b1, b2, b3, b4, b5, b6, b7, b8, b9) {}
// More parameters than a byte of the table counts.
function huge(q0, q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12, q13, q14, q15, q16, q17, q18, q19, q20, q21, q22, q23, q24, q25, q26, q27, q28, q29, q30, q31, q32, q33, q34, q35, q36, q37, q38, q39, q40, q41, q42, q43, q44, q45, q46, q47, q48, q49, q50, q51, q52, q53, q54, q55, q56, q57, q58, q59, q60, q61, q62, q63, q64, q65, q66, q67, q68, q69, q70, q71, q72, q73, q74, q75, q76, q77, q78, q79, q80, q81, q82, q83, q84, q85, q86, q87, q88, q89, q90, q91, q92, q93, q94, q95, q96, q97, q98, q99, q100, q101, q102, q103, q104, q105, q106, q107, q108, q109, q110, q111, q112, q113, q114, q115, q116, q117, q118, q119, q120, q121, q122, q123, q124, q125, q126, q127, q128, q129, q130, q131, q132, q133, q134, q135, q136, q137, q138, q139, q140, q141, q142, q143, q144, q145, q146, q147, q148, q149, q150, q151, q152, q153, q154, q155, q156, q157, q158, q159, q160, q161, q162, q163, q164, q165, q166, q167, q168, q169, q170, q171, q172, q173, q174, q175, q176, q177, q178, q179, q180, q181, q182, q183, q184, q185, q186, q187, q188, q189, q190, q191, q192, q193, q194, q195, q196, q197, q198, q199, q200, q201, q202, q203, q204, q205, q206, q207, q208, q209, q210, q211, q212, q213, q214, q215, q216, q217, q218, q219, q220, q221, q222, q223, q224, q225, q226, q227, q228, q229, q230, q231, q232, q233, q234, q235, q236, q237, q238, q239, q240, q241, q242, q243, q244, q245, q246, q247, q248, q249, q250, q251, q252, q253, q254, q255, q256, q257, q258, q259) {}
function edge(r0, r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14, r15, r16, r17, r18, r19, r20, r21, r22, r23, r24, r25, r26, r27, r28, r29, r30, r31, r32, r33, r34, r35, r36, r37, r38, r39, r40, r41, r42, r43, r44, r45, r46, r47, r48, r49, r50, r51, r52, r53, r54, r55, r56, r57, r58, r59, r60, r61, r62, r63, r64, r65, r66, r67, r68, r69, r70, r71, r72, r73, r74, r75, r76, r77, r78, r79, r80, r81, r82, r83, r84, r85, r86, r87, r88, r89, r90, r91, r92, r93, r94, r95, r96, r97, r98, r99, r100, r101, r102, r103, r104, r105, r106, r107, r108, r109, r110, r111, r112, r113, r114, r115, r116, r117, r118, r119, r120, r121, r122, r123, r124, r125, r126, r127, r128, r129, r130, r131, r132, r133, r134, r135, r136, r137, r138, r139, r140, r141, r142, r143, r144, r145, r146, r147, r148, r149, r150, r151, r152, r153, r154, r155, r156, r157, r158, r159, r160, r161, r162, r163, r164, r165, r166, r167, r168, r169, r170, r171, r172, r173, r174, r175, r176, r177, r178, r179, r180, r181, r182, r183, r184, r185, r186, r187, r188, r189, r190, r191, r192, r193, r194, r195, r196, r197, r198, r199, r200, r201, r202, r203, r204, r205, r206, r207, r208, r209, r210, r211, r212, r213, r214, r215, r216, r217, r218, r219, r220, r221, r222, r223, r224, r225, r226, r227, r228, r229, r230, r231, r232, r233, r234, r235, r236, r237, r238, r239, r240, r241, r242, r243, r244, r245, r246, r247, r248, r249, r250, r251, r252, r253, r254) {}
function under(s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s25, s26, s27, s28, s29, s30, s31, s32, s33, s34, s35, s36, s37, s38, s39, s40, s41, s42, s43, s44, s45, s46, s47, s48, s49, s50, s51, s52, s53, s54, s55, s56, s57, s58, s59, s60, s61, s62, s63, s64, s65, s66, s67, s68, s69, s70, s71, s72, s73, s74, s75, s76, s77, s78, s79, s80, s81, s82, s83, s84, s85, s86, s87, s88, s89, s90, s91, s92, s93, s94, s95, s96, s97, s98, s99, s100, s101, s102, s103, s104, s105, s106, s107, s108, s109, s110, s111, s112, s113, s114, s115, s116, s117, s118, s119, s120, s121, s122, s123, s124, s125, s126, s127, s128, s129, s130, s131, s132, s133, s134, s135, s136, s137, s138, s139, s140, s141, s142, s143, s144, s145, s146, s147, s148, s149, s150, s151, s152, s153, s154, s155, s156, s157, s158, s159, s160, s161, s162, s163, s164, s165, s166, s167, s168, s169, s170, s171, s172, s173, s174, s175, s176, s177, s178, s179, s180, s181, s182, s183, s184, s185, s186, s187, s188, s189, s190, s191, s192, s193, s194, s195, s196, s197, s198, s199, s200, s201, s202, s203, s204, s205, s206, s207, s208, s209, s210, s211, s212, s213, s214, s215, s216, s217, s218, s219, s220, s221, s222, s223, s224, s225, s226, s227, s228, s229, s230, s231, s232, s233, s234, s235, s236, s237, s238, s239, s240, s241, s242, s243, s244, s245, s246, s247, s248, s249, s250, s251, s252, s253) {}
const wide = new Function(...Array.from({ length: 300 }, (_, index) => "p" + index), "return 1");
const captured = (() => { let count = 0; return (a, b, c, d, e) => count++; })();
const kinds = {
  three, withDefault, withRest, many, captured,
  arrow: (a, b) => a,
  none: () => 0,
  method: holder.run,
  getter: Object.getOwnPropertyDescriptor(holder, "size").get,
  later: holder.later,
  each: holder.each,
  bound: holder.run.bind(holder),
  boundWithArguments: three.bind(null, 1).bind(null, 2),
  native: Math.max,
  wide,
  classObject: class { constructor(a, b, c) {} },
  classWithoutConstructor: class {},
};
function Layer(handle) { this.handle = handle; }
Layer.prototype.arity = function () {
  const fn = this.handle;
  return fn.length > 3 ? -fn.length : fn.length;
};
const names = Object.keys(kinds);
const layers = names.map(name => new Layer(kinds[name]));
function sumOfArities(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += layers[round % layers.length].arity() * (round % 7);
  return sum;
}
console.log(names.map((name, index) => name + " " + layers[index].arity()).join(", "));
console.log(sumOfArities(40000));
for (const layer of [new Layer(huge), new Layer(edge), new Layer(under)]) console.log(layer.arity(), layer.arity(), layer.handle.length);

// A function whose length is changed says so from then on, and the others go on as they were.
const key = "length";
Object.defineProperty(three, "length", { value: 9 });
Object.defineProperty(kinds.arrow, "length", { get() { return 11; }, configurable: true });
delete kinds.method.length;
delete kinds.captured.length;
Object.defineProperty(kinds.later, "length", { value: "text", configurable: true });
kinds.none.extra = 1;
Object.freeze(kinds.withRest);
Object.setPrototypeOf(kinds.captured, { length: 77 });
try { kinds.many.length = 5; } catch (error) { console.log(error.constructor.name); }
console.log(names.map((name, index) => name + " " + layers[index].arity() + " " + kinds[name][key] + " " + Object.hasOwn(kinds[name], "length") + " " + ("length" in kinds[name])).join(", "));
console.log(sumOfArities(4000));
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(withDefault, "length")), JSON.stringify(Object.getOwnPropertyDescriptor(three, "length")));
