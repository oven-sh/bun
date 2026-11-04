// @ts-nocheck
class Above {}
const seen = new Set<string>();
const above = new Proxy(Above.prototype, {});
function watch(name: string) { if (seen.has(name)) return; seen.add(name); Object.defineProperty(Above.prototype, name, { set(value) { console.log("  set", name); }, configurable: true }); }
watch("y");
const keys = (o: object) => Reflect.ownKeys(o).map(String).join("+") || "none";
try { watch(String(`a${1}`)); } catch {}
class C1 extends Above { [`a${1}`] = 1; y = 2; }
console.log(1, '`a${1}`', keys(new C1()));
class S1 extends Above { static [`a${1}`] = 1; y = 2; }
console.log(1, "static", keys(new S1()));
try { watch(String(`é${1}`)); } catch {}
class C2 extends Above { [`é${1}`] = 1; y = 2; }
console.log(2, '`é${1}`', keys(new C2()));
class S2 extends Above { static [`é${1}`] = 1; y = 2; }
console.log(2, "static", keys(new S2()));
try { watch(String(`${1}é`)); } catch {}
class C3 extends Above { [`${1}é`] = 1; y = 2; }
console.log(3, '`${1}é`', keys(new C3()));
class S3 extends Above { static [`${1}é`] = 1; y = 2; }
console.log(3, "static", keys(new S3()));
try { watch(String(`${"é"}`)); } catch {}
class C4 extends Above { [`${"é"}`] = 1; y = 2; }
console.log(4, '`${"é"}`', keys(new C4()));
class S4 extends Above { static [`${"é"}`] = 1; y = 2; }
console.log(4, "static", keys(new S4()));
try { watch(String(`a${"b"}c`)); } catch {}
class C5 extends Above { [`a${"b"}c`] = 1; y = 2; }
console.log(5, '`a${"b"}c`', keys(new C5()));
class S5 extends Above { static [`a${"b"}c`] = 1; y = 2; }
console.log(5, "static", keys(new S5()));
try { watch(String(`é`)); } catch {}
class C6 extends Above { [`é`] = 1; y = 2; }
console.log(6, '`é`', keys(new C6()));
class S6 extends Above { static [`é`] = 1; y = 2; }
console.log(6, "static", keys(new S6()));
try { watch(String(`a`)); } catch {}
class C7 extends Above { [`a`] = 1; y = 2; }
console.log(7, '`a`', keys(new C7()));
class S7 extends Above { static [`a`] = 1; y = 2; }
console.log(7, "static", keys(new S7()));
try { watch(String("é" + 1)); } catch {}
class C8 extends Above { ["é" + 1] = 1; y = 2; }
console.log(8, '"é" + 1', keys(new C8()));
class S8 extends Above { static ["é" + 1] = 1; y = 2; }
console.log(8, "static", keys(new S8()));
try { watch(String("a" + 1)); } catch {}
class C9 extends Above { ["a" + 1] = 1; y = 2; }
console.log(9, '"a" + 1', keys(new C9()));
class S9 extends Above { static ["a" + 1] = 1; y = 2; }
console.log(9, "static", keys(new S9()));
try { watch(String(`\u00e9${1}`)); } catch {}
class C10 extends Above { [`\u00e9${1}`] = 1; y = 2; }
console.log(10, '`\\u00e9${1}`', keys(new C10()));
class S10 extends Above { static [`\u00e9${1}`] = 1; y = 2; }
console.log(10, "static", keys(new S10()));
try { watch(String(`${1}${2}`)); } catch {}
class C11 extends Above { [`${1}${2}`] = 1; y = 2; }
console.log(11, '`${1}${2}`', keys(new C11()));
class S11 extends Above { static [`${1}${2}`] = 1; y = 2; }
console.log(11, "static", keys(new S11()));
try { watch(String(`${1n}`)); } catch {}
class C12 extends Above { [`${1n}`] = 1; y = 2; }
console.log(12, '`${1n}`', keys(new C12()));
class S12 extends Above { static [`${1n}`] = 1; y = 2; }
console.log(12, "static", keys(new S12()));
try { watch(String(`${0x1n}`)); } catch {}
class C13 extends Above { [`${0x1n}`] = 1; y = 2; }
console.log(13, '`${0x1n}`', keys(new C13()));
class S13 extends Above { static [`${0x1n}`] = 1; y = 2; }
console.log(13, "static", keys(new S13()));
try { watch(String(`${true}`)); } catch {}
class C14 extends Above { [`${true}`] = 1; y = 2; }
console.log(14, '`${true}`', keys(new C14()));
class S14 extends Above { static [`${true}`] = 1; y = 2; }
console.log(14, "static", keys(new S14()));
try { watch(String(`${null}`)); } catch {}
class C15 extends Above { [`${null}`] = 1; y = 2; }
console.log(15, '`${null}`', keys(new C15()));
class S15 extends Above { static [`${null}`] = 1; y = 2; }
console.log(15, "static", keys(new S15()));
try { watch(String(`${undefined}`)); } catch {}
class C16 extends Above { [`${undefined}`] = 1; y = 2; }
console.log(16, '`${undefined}`', keys(new C16()));
class S16 extends Above { static [`${undefined}`] = 1; y = 2; }
console.log(16, "static", keys(new S16()));
try { watch(String(`${1.5}`)); } catch {}
class C17 extends Above { [`${1.5}`] = 1; y = 2; }
console.log(17, '`${1.5}`', keys(new C17()));
class S17 extends Above { static [`${1.5}`] = 1; y = 2; }
console.log(17, "static", keys(new S17()));
try { watch(String(`${-0}`)); } catch {}
class C18 extends Above { [`${-0}`] = 1; y = 2; }
console.log(18, '`${-0}`', keys(new C18()));
class S18 extends Above { static [`${-0}`] = 1; y = 2; }
console.log(18, "static", keys(new S18()));
try { watch(String(`${"a"}${"é"}`)); } catch {}
class C19 extends Above { [`${"a"}${"é"}`] = 1; y = 2; }
console.log(19, '`${"a"}${"é"}`', keys(new C19()));
class S19 extends Above { static [`${"a"}${"é"}`] = 1; y = 2; }
console.log(19, "static", keys(new S19()));
try { watch(String(true ? `é${1}` : 0)); } catch {}
class C20 extends Above { [true ? `é${1}` : 0] = 1; y = 2; }
console.log(20, 'true ? `é${1}` : 0', keys(new C20()));
class S20 extends Above { static [true ? `é${1}` : 0] = 1; y = 2; }
console.log(20, "static", keys(new S20()));
try { watch(String(0 || `a${1}`)); } catch {}
class C21 extends Above { [0 || `a${1}`] = 1; y = 2; }
console.log(21, '0 || `a${1}`', keys(new C21()));
class S21 extends Above { static [0 || `a${1}`] = 1; y = 2; }
console.log(21, "static", keys(new S21()));
try { watch(String(0x1n)); } catch {}
class C22 extends Above { [0x1n] = 1; y = 2; }
console.log(22, '0x1n', keys(new C22()));
class S22 extends Above { static [0x1n] = 1; y = 2; }
console.log(22, "static", keys(new S22()));
try { watch(String(1n)); } catch {}
class C23 extends Above { [1n] = 1; y = 2; }
console.log(23, '1n', keys(new C23()));
class S23 extends Above { static [1n] = 1; y = 2; }
console.log(23, "static", keys(new S23()));
try { watch(String(-1n)); } catch {}
class C24 extends Above { [-1n] = 1; y = 2; }
console.log(24, '-1n', keys(new C24()));
class S24 extends Above { static [-1n] = 1; y = 2; }
console.log(24, "static", keys(new S24()));
try { watch(String(0b1n)); } catch {}
class C25 extends Above { [0b1n] = 1; y = 2; }
console.log(25, '0b1n', keys(new C25()));
class S25 extends Above { static [0b1n] = 1; y = 2; }
console.log(25, "static", keys(new S25()));
try { watch(String(0x10)); } catch {}
class C26 extends Above { [0x10] = 1; y = 2; }
console.log(26, '0x10', keys(new C26()));
class S26 extends Above { static [0x10] = 1; y = 2; }
console.log(26, "static", keys(new S26()));
try { watch(String(1_0)); } catch {}
class C27 extends Above { [1_0] = 1; y = 2; }
console.log(27, '1_0', keys(new C27()));
class S27 extends Above { static [1_0] = 1; y = 2; }
console.log(27, "static", keys(new S27()));
try { watch(String(1e3)); } catch {}
class C28 extends Above { [1e3] = 1; y = 2; }
console.log(28, '1e3', keys(new C28()));
class S28 extends Above { static [1e3] = 1; y = 2; }
console.log(28, "static", keys(new S28()));
try { watch(String(.5)); } catch {}
class C29 extends Above { [.5] = 1; y = 2; }
console.log(29, '.5', keys(new C29()));
class S29 extends Above { static [.5] = 1; y = 2; }
console.log(29, "static", keys(new S29()));
try { watch(String("\x41")); } catch {}
class C30 extends Above { ["\x41"] = 1; y = 2; }
console.log(30, '"\\x41"', keys(new C30()));
class S30 extends Above { static ["\x41"] = 1; y = 2; }
console.log(30, "static", keys(new S30()));
try { watch(String('a')); } catch {}
class C31 extends Above { ['a'] = 1; y = 2; }
console.log(31, "'a'", keys(new C31()));
class S31 extends Above { static ['a'] = 1; y = 2; }
console.log(31, "static", keys(new S31()));
try { watch(String(("a"))); } catch {}
class C32 extends Above { [("a")] = 1; y = 2; }
console.log(32, '("a")', keys(new C32()));
class S32 extends Above { static [("a")] = 1; y = 2; }
console.log(32, "static", keys(new S32()));
try { watch(String("a" as string)); } catch {}
class C33 extends Above { ["a" as string] = 1; y = 2; }
console.log(33, '"a" as string', keys(new C33()));
class S33 extends Above { static ["a" as string] = 1; y = 2; }
console.log(33, "static", keys(new S33()));
try { watch(String(<string>"a")); } catch {}
class C34 extends Above { [<string>"a"] = 1; y = 2; }
console.log(34, '<string>"a"', keys(new C34()));
class S34 extends Above { static [<string>"a"] = 1; y = 2; }
console.log(34, "static", keys(new S34()));
try { watch(String("a"!)); } catch {}
class C35 extends Above { ["a"!] = 1; y = 2; }
console.log(35, '"a"!', keys(new C35()));
class S35 extends Above { static ["a"!] = 1; y = 2; }
console.log(35, "static", keys(new S35()));
try { watch(String(void 0)); } catch {}
class C36 extends Above { [void 0] = 1; y = 2; }
console.log(36, 'void 0', keys(new C36()));
class S36 extends Above { static [void 0] = 1; y = 2; }
console.log(36, "static", keys(new S36()));
try { watch(String(null)); } catch {}
class C37 extends Above { [null] = 1; y = 2; }
console.log(37, 'null', keys(new C37()));
class S37 extends Above { static [null] = 1; y = 2; }
console.log(37, "static", keys(new S37()));
try { watch(String(true)); } catch {}
class C38 extends Above { [true] = 1; y = 2; }
console.log(38, 'true', keys(new C38()));
class S38 extends Above { static [true] = 1; y = 2; }
console.log(38, "static", keys(new S38()));
try { watch(String(!0)); } catch {}
class C39 extends Above { [!0] = 1; y = 2; }
console.log(39, '!0', keys(new C39()));
class S39 extends Above { static [!0] = 1; y = 2; }
console.log(39, "static", keys(new S39()));
try { watch(String(-1)); } catch {}
class C40 extends Above { [-1] = 1; y = 2; }
console.log(40, '-1', keys(new C40()));
class S40 extends Above { static [-1] = 1; y = 2; }
console.log(40, "static", keys(new S40()));
try { watch(String(+1)); } catch {}
class C41 extends Above { [+1] = 1; y = 2; }
console.log(41, '+1', keys(new C41()));
class S41 extends Above { static [+1] = 1; y = 2; }
console.log(41, "static", keys(new S41()));
try { watch(String(~1)); } catch {}
class C42 extends Above { [~1] = 1; y = 2; }
console.log(42, '~1', keys(new C42()));
class S42 extends Above { static [~1] = 1; y = 2; }
console.log(42, "static", keys(new S42()));
try { watch(String(- -1)); } catch {}
class C43 extends Above { [- -1] = 1; y = 2; }
console.log(43, '- -1', keys(new C43()));
class S43 extends Above { static [- -1] = 1; y = 2; }
console.log(43, "static", keys(new S43()));
try { watch(String(-NaN)); } catch {}
class C44 extends Above { [-NaN] = 1; y = 2; }
console.log(44, '-NaN', keys(new C44()));
class S44 extends Above { static [-NaN] = 1; y = 2; }
console.log(44, "static", keys(new S44()));
try { watch(String(-Infinity)); } catch {}
class C45 extends Above { [-Infinity] = 1; y = 2; }
console.log(45, '-Infinity', keys(new C45()));
class S45 extends Above { static [-Infinity] = 1; y = 2; }
console.log(45, "static", keys(new S45()));
try { watch(String(Infinity)); } catch {}
class C46 extends Above { [Infinity] = 1; y = 2; }
console.log(46, 'Infinity', keys(new C46()));
class S46 extends Above { static [Infinity] = 1; y = 2; }
console.log(46, "static", keys(new S46()));
try { watch(String(1 + 1)); } catch {}
class C47 extends Above { [1 + 1] = 1; y = 2; }
console.log(47, '1 + 1', keys(new C47()));
class S47 extends Above { static [1 + 1] = 1; y = 2; }
console.log(47, "static", keys(new S47()));
try { watch(String(2 ** 3)); } catch {}
class C48 extends Above { [2 ** 3] = 1; y = 2; }
console.log(48, '2 ** 3', keys(new C48()));
class S48 extends Above { static [2 ** 3] = 1; y = 2; }
console.log(48, "static", keys(new S48()));
try { watch(String(7 % 4)); } catch {}
class C49 extends Above { [7 % 4] = 1; y = 2; }
console.log(49, '7 % 4', keys(new C49()));
class S49 extends Above { static [7 % 4] = 1; y = 2; }
console.log(49, "static", keys(new S49()));
try { watch(String(1 << 2)); } catch {}
class C50 extends Above { [1 << 2] = 1; y = 2; }
console.log(50, '1 << 2', keys(new C50()));
class S50 extends Above { static [1 << 2] = 1; y = 2; }
console.log(50, "static", keys(new S50()));
try { watch(String("ab".length)); } catch {}
class C51 extends Above { ["ab".length] = 1; y = 2; }
console.log(51, '"ab".length', keys(new C51()));
class S51 extends Above { static ["ab".length] = 1; y = 2; }
console.log(51, "static", keys(new S51()));
try { watch(String("ab"[0])); } catch {}
class C52 extends Above { ["ab"[0]] = 1; y = 2; }
console.log(52, '"ab"[0]', keys(new C52()));
class S52 extends Above { static ["ab"[0]] = 1; y = 2; }
console.log(52, "static", keys(new S52()));
try { watch(String(typeof 1)); } catch {}
class C53 extends Above { [typeof 1] = 1; y = 2; }
console.log(53, 'typeof 1', keys(new C53()));
class S53 extends Above { static [typeof 1] = 1; y = 2; }
console.log(53, "static", keys(new S53()));
try { watch(String(typeof "a" === "string" ? "s" : "n")); } catch {}
class C54 extends Above { [typeof "a" === "string" ? "s" : "n"] = 1; y = 2; }
console.log(54, 'typeof "a" === "string" ? "s" : "n"', keys(new C54()));
class S54 extends Above { static [typeof "a" === "string" ? "s" : "n"] = 1; y = 2; }
console.log(54, "static", keys(new S54()));
try { watch(String(1 ? "x" : "z")); } catch {}
class C55 extends Above { [1 ? "x" : "z"] = 1; y = 2; }
console.log(55, '1 ? "x" : "z"', keys(new C55()));
class S55 extends Above { static [1 ? "x" : "z"] = 1; y = 2; }
console.log(55, "static", keys(new S55()));
try { watch(String("" || "x")); } catch {}
class C56 extends Above { ["" || "x"] = 1; y = 2; }
console.log(56, '"" || "x"', keys(new C56()));
class S56 extends Above { static ["" || "x"] = 1; y = 2; }
console.log(56, "static", keys(new S56()));
try { watch(String("a" && "x")); } catch {}
class C57 extends Above { ["a" && "x"] = 1; y = 2; }
console.log(57, '"a" && "x"', keys(new C57()));
class S57 extends Above { static ["a" && "x"] = 1; y = 2; }
console.log(57, "static", keys(new S57()));
try { watch(String(null ?? "x")); } catch {}
class C58 extends Above { [null ?? "x"] = 1; y = 2; }
console.log(58, 'null ?? "x"', keys(new C58()));
class S58 extends Above { static [null ?? "x"] = 1; y = 2; }
console.log(58, "static", keys(new S58()));
try { watch(String((0, "x"))); } catch {}
class C59 extends Above { [(0, "x")] = 1; y = 2; }
console.log(59, '(0, "x")', keys(new C59()));
class S59 extends Above { static [(0, "x")] = 1; y = 2; }
console.log(59, "static", keys(new S59()));
export {};
