// The strings array of a tagged template: property attributes, frozen state, cooked and raw text, and one array per site.
export {};

const stringsOf = (strings: TemplateStringsArray, ..._values: unknown[]): TemplateStringsArray => strings;
const partsOf = (strings: TemplateStringsArray, ...values: number[]) => ({ strings, values });

function quote(value: unknown): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function codeUnitsOf(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) result += (i ? " " : "") + text.charCodeAt(i).toString(16);
  return result;
}

function attributesOf(object: object, key: PropertyKey): string {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return "absent";
  const value = Array.isArray(descriptor.value) ? "array" : quote(descriptor.value);
  return `${value} writable:${descriptor.writable} enumerable:${descriptor.enumerable} configurable:${descriptor.configurable}`;
}

function outcomeOf(action: () => void): string {
  try {
    action();
    return "no error";
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "another error";
  }
}

const pair = stringsOf`left${1}right`;
console.log("element 0:", attributesOf(pair, 0));
console.log("element 1:", attributesOf(pair, 1));
console.log("element 2:", attributesOf(pair, 2));
console.log("length:", attributesOf(pair, "length"));
console.log("raw:", attributesOf(pair, "raw"));
console.log("raw element 0:", attributesOf(pair.raw, 0));
console.log("raw element 1:", attributesOf(pair.raw, 1));
console.log("raw length:", attributesOf(pair.raw, "length"));
console.log("raw of raw:", attributesOf(pair.raw, "raw"));
console.log("own keys:", Reflect.ownKeys(pair).join(), "|", Reflect.ownKeys(pair.raw).join(), "|", Object.keys(pair).join());
console.log("frozen:", Object.isFrozen(pair), Object.isFrozen(pair.raw), Object.isExtensible(pair), Object.isExtensible(pair.raw));
console.log("arrays:", Array.isArray(pair), Array.isArray(pair.raw), Object.getPrototypeOf(pair) === Array.prototype, Object.getPrototypeOf(pair.raw) === Array.prototype);

const unchecked: any = pair;
console.log("store to an element:", outcomeOf(() => { unchecked[0] = "x"; }), outcomeOf(() => { unchecked.raw[1] = "x"; }));
console.log("store past the end:", outcomeOf(() => { unchecked[2] = "x"; }), outcomeOf(() => { unchecked.raw[2] = "x"; }));
console.log("store to length:", outcomeOf(() => { unchecked.length = 0; }), outcomeOf(() => { unchecked.raw.length = 0; }));
console.log("store to raw:", outcomeOf(() => { unchecked.raw = []; }));
console.log("push and pop:", outcomeOf(() => { unchecked.push("x"); }), outcomeOf(() => { unchecked.raw.pop(); }));
console.log("delete:", outcomeOf(() => { delete unchecked[1]; }), outcomeOf(() => { delete unchecked.raw; }));
console.log("define:", outcomeOf(() => { Object.defineProperty(unchecked, 0, { value: "x" }); }), outcomeOf(() => { Object.defineProperty(unchecked, 0, { value: "left" }); }));
console.log("unchanged:", quote(pair), quote(pair.raw));

const invalid = stringsOf`\unicode${0}\xg${1}\u{110000}${2}\01${3}valid\n`;
console.log("invalid escapes:", invalid.length, invalid.map(quote).join(" "), "|", invalid.raw.map(quote).join(" "));
console.log("undefined is an element:", 0 in invalid, attributesOf(invalid, 0), "|", attributesOf(invalid.raw, 0));
console.log("invalid escapes, frozen:", Object.isFrozen(invalid), Object.isFrozen(invalid.raw));

const empty = stringsOf``;
const onlySubstitutions = stringsOf`${1}${2}`;
console.log("empty:", empty.length, quote(empty), quote(empty.raw), onlySubstitutions.length, quote(onlySubstitutions), quote(onlySubstitutions.raw));

const nonASCII = stringsOf`é${1}日本語${2}😀${3}ÿĀ${4}\u00e9\u{1f600}`;
for (let i = 0; i < nonASCII.length; i++) console.log("non-ASCII", i, nonASCII[i], codeUnitsOf(nonASCII[i]));
console.log("non-ASCII, written as escapes:", nonASCII.raw[4]);

const surrogates = stringsOf`\ud800${1}\udc00x${2}a\ud83d${3}\ud83d\ude00`;
for (let i = 0; i < surrogates.length; i++) console.log("surrogates", i, codeUnitsOf(surrogates[i]), quote(surrogates[i]), "|", surrogates.raw[i]);

const many = partsOf`p0${0}p1${1}p2${2}p3${3}p4${4}p5${5}p6${6}p7${7}p8${8}p9${9}p10${10}p11${11}p12${12}p13${13}p14${14}p15${15}p16${16}p17${17}p18${18}p19${19}p20${20}p21${21}p22${22}p23${23}p24${24}p25${25}p26${26}p27${27}p28${28}p29${29}p30${30}p31${31}p32${32}p33${33}p34${34}p35${35}p36${36}p37${37}p38${38}p39${39}p40${40}p41${41}p42${42}p43${43}p44${44}p45${45}p46${46}p47${47}p48${48}p49${49}p50${50}p51${51}p52${52}p53${53}p54${54}p55${55}p56${56}p57${57}p58${58}p59${59}p60${60}p61${61}p62${62}p63${63}p64${64}p65${65}p66${66}p67${67}p68${68}p69${69}p70${70}p71${71}p72${72}p73${73}p74${74}p75${75}p76${76}p77${77}p78${78}p79${79}p80${80}p81${81}p82${82}p83${83}p84${84}p85${85}p86${86}p87${87}p88${88}p89${89}p90${90}p91${91}p92${92}p93${93}p94${94}p95${95}p96${96}p97${97}p98${98}p99${99}p100${100}p101${101}p102${102}p103${103}p104${104}p105${105}p106${106}p107${107}p108${108}p109${109}p110${110}p111${111}p112${112}p113${113}p114${114}p115${115}p116${116}p117${117}p118${118}p119${119}p120${120}p121${121}p122${122}p123${123}p124${124}p125${125}p126${126}p127${127}p128${128}p129${129}p130${130}p131${131}p132${132}p133${133}p134${134}p135${135}p136${136}p137${137}p138${138}p139${139}p140${140}p141${141}p142${142}p143${143}p144${144}p145${145}p146${146}p147${147}p148${148}p149${149}p150${150}p151${151}p152${152}p153${153}p154${154}p155${155}p156${156}p157${157}p158${158}p159${159}p160${160}p161${161}p162${162}p163${163}p164${164}p165${165}p166${166}p167${167}p168${168}p169${169}p170${170}p171${171}p172${172}p173${173}p174${174}p175${175}p176${176}p177${177}p178${178}p179${179}p180${180}p181${181}p182${182}p183${183}p184${184}p185${185}p186${186}p187${187}p188${188}p189${189}p190${190}p191${191}p192${192}p193${193}p194${194}p195${195}p196${196}p197${197}p198${198}p199${199}p200${200}p201${201}p202${202}p203${203}p204${204}p205${205}p206${206}p207${207}p208${208}p209${209}p210${210}p211${211}p212${212}p213${213}p214${214}p215${215}p216${216}p217${217}p218${218}p219${219}p220${220}p221${221}p222${222}p223${223}p224${224}p225${225}p226${226}p227${227}p228${228}p229${229}p230${230}p231${231}p232${232}p233${233}p234${234}p235${235}p236${236}p237${237}p238${238}p239${239}p240${240}p241${241}p242${242}p243${243}p244${244}p245${245}p246${246}p247${247}p248${248}p249${249}p250${250}p251${251}p252${252}p253${253}p254${254}p255${255}p256${256}p257${257}p258${258}p259${259}p260${260}p261${261}p262${262}p263${263}p264${264}p265${265}p266${266}p267${267}p268${268}p269${269}p270${270}p271${271}p272${272}p273${273}p274${274}p275${275}p276${276}p277${277}p278${278}p279${279}p280${280}p281${281}p282${282}p283${283}p284${284}p285${285}p286${286}p287${287}p288${288}p289${289}p290${290}p291${291}p292${292}p293${293}p294${294}p295${295}p296${296}p297${297}p298${298}p299${299}p300`;
let matching = 0;
for (let i = 0; i < many.strings.length; i++) if (many.strings[i] === "p" + i && many.strings.raw[i] === "p" + i) matching++;
console.log("300 substitutions:", many.strings.length, many.strings.raw.length, matching, many.values.length, many.values.reduce((sum, value) => sum + value, 0));
console.log("300 substitutions, last:", attributesOf(many.strings, 300), "|", attributesOf(many.strings.raw, 300), "|", attributesOf(many.strings, 301));
console.log("300 substitutions, frozen:", Object.isFrozen(many.strings), Object.isFrozen(many.strings.raw));

function sameStrings(): TemplateStringsArray[] {
  return [stringsOf`same${0}strings`, stringsOf`same${0}strings`];
}
const [first, second] = sameStrings();
console.log("two sites with the same strings:", first === second, first.raw === second.raw, quote(first) === quote(second), quote(first.raw) === quote(second.raw));
console.log("each site again:", sameStrings()[0] === first, sameStrings()[1] === second, sameStrings()[0] === second);

const fromLoop: TemplateStringsArray[] = [];
for (let i = 0; i < 3; i++) fromLoop.push(stringsOf`loop${i}`);
console.log("one site in a loop:", fromLoop[0] === fromLoop[1], fromLoop[1] === fromLoop[2], fromLoop[0].raw === fromLoop[2].raw);

const createReader = (): (() => TemplateStringsArray) => () => stringsOf`closure`;
const readers = [createReader(), createReader()];
console.log("one site in two closures:", readers[0] === readers[1], readers[0]() === readers[1](), readers[0]() === readers[0]());
