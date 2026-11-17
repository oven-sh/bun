// [..].includes(x) of declared strings, numbers and unions, which the values keep or not.
// STATISTIC: MembershipsComparedInline >= 30
type Kind = "g1" | "g3" | "g5" | "a"; interface Row { kind: Kind; id: number; name: string }
const values: any[] = JSON.parse('["", "a", "b", "ab", "g1", "g3", "g5", "longer text here", 0, 1, 2, 5, 9, -1, 0.5, null, true, false, "1", "日本", "é", "k", "l"]');
const text: string = "xx g1 g3 ab longer text here 日本", zero: number = values[8], sought: any[] = [...values, undefined, zero / zero, -zero, 2 ** 31, Infinity, text.slice(3, 5), "g" + values[9], { toString: () => "a" }, 1n, () => 1];
const all: boolean = process.argv[2] === "all"; let lines = 0, hash = 0;
function say(line: string): void { lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (all) console.log(line); else if (lines % 23 === 0) console.log(lines, hash); }
function textsOnce(x: string): any { return ["g1", "g3", "g5"].includes(x); }
function textsOf(list: string[]): string { let s = ""; for (const x of list) { try { s += ["g1", "g3", "g5"].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function textsCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (["g1", "g3", "g5"].includes(x)) n += i; else n--; } return n; }
function oneOnce(x: string): any { return ["a"].includes(x); }
function oneOf(list: string[]): string { let s = ""; for (const x of list) { try { s += ["a"].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function oneCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (["a"].includes(x)) n += i; else n--; } return n; }
function emptyOnce(x: string): any { return ["", "a"].includes(x); }
function emptyOf(list: string[]): string { let s = ""; for (const x of list) { try { s += ["", "a"].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function emptyCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (["", "a"].includes(x)) n += i; else n--; } return n; }
function numbersOnce(x: number): any { return [1, 5, 9].includes(x); }
function numbersOf(list: number[]): string { let s = ""; for (const x of list) { try { s += [1, 5, 9].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function numbersCount(list: number[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if ([1, 5, 9].includes(x)) n += i; else n--; } return n; }
function zerosOnce(x: number): any { return [0, -1].includes(x); }
function zerosOf(list: number[]): string { let s = ""; for (const x of list) { try { s += [0, -1].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function zerosCount(list: number[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if ([0, -1].includes(x)) n += i; else n--; } return n; }
function doublesOnce(x: number): any { return [0.5, 1.5, 1e300].includes(x); }
function doublesOf(list: number[]): string { let s = ""; for (const x of list) { try { s += [0.5, 1.5, 1e300].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function doublesCount(list: number[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if ([0.5, 1.5, 1e300].includes(x)) n += i; else n--; } return n; }
function truthsOnce(x: boolean): any { return [true, false].includes(x); }
function truthsOf(list: boolean[]): string { let s = ""; for (const x of list) { try { s += [true, false].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function truthsCount(list: boolean[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if ([true, false].includes(x)) n += i; else n--; } return n; }
function wideOnce(x: string): any { return ["日本", "é"].includes(x); }
function wideOf(list: string[]): string { let s = ""; for (const x of list) { try { s += ["日本", "é"].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function wideCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (["日本", "é"].includes(x)) n += i; else n--; } return n; }
function longOnce(x: string): any { return ["longer text here", "another longer text"].includes(x); }
function longOf(list: string[]): string { let s = ""; for (const x of list) { try { s += ["longer text here", "another longer text"].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function longCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (["longer text here", "another longer text"].includes(x)) n += i; else n--; } return n; }
function eightOnce(x: string): any { return ["a", "b", "c", "d", "e", "f", "g1", "h"].includes(x); }
function eightOf(list: string[]): string { let s = ""; for (const x of list) { try { s += ["a", "b", "c", "d", "e", "f", "g1", "h"].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function eightCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (["a", "b", "c", "d", "e", "f", "g1", "h"].includes(x)) n += i; else n--; } return n; }
function nineOnce(x: string): any { return ["a", "b", "c", "d", "e", "f", "g1", "h", "g3"].includes(x); }
function nineOf(list: string[]): string { let s = ""; for (const x of list) { try { s += ["a", "b", "c", "d", "e", "f", "g1", "h", "g3"].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function nineCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (["a", "b", "c", "d", "e", "f", "g1", "h", "g3"].includes(x)) n += i; else n--; } return n; }
function twelveOnce(x: string): any { return ["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "g3"].includes(x); }
function twelveOf(list: string[]): string { let s = ""; for (const x of list) { try { s += ["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "g3"].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function twelveCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "g3"].includes(x)) n += i; else n--; } return n; }
function thirteenOnce(x: string): any { return ["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "l", "g3"].includes(x); }
function thirteenOf(list: string[]): string { let s = ""; for (const x of list) { try { s += ["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "l", "g3"].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function thirteenCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "l", "g3"].includes(x)) n += i; else n--; } return n; }
function indexOfOnce(x: string): any { return ["g1", "g3", "g5"].indexOf(x); }
function indexOfOf(list: string[]): string { let s = ""; for (const x of list) { try { s += ["g1", "g3", "g5"].indexOf(x) + " "; } catch (e) { s += "!"; } } return s; }
function indexOfCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (["g1", "g3", "g5"].indexOf(x)) n += i; else n--; } return n; }
function notIncludedOnce(x: string): any { return !["g1", "g3"].includes(x); }
function notIncludedOf(list: string[]): string { let s = ""; for (const x of list) { try { s += !["g1", "g3"].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function notIncludedCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (!["g1", "g3"].includes(x)) n += i; else n--; } return n; }
function choiceOnce(x: string): any { return (["a", "b"].includes(x) ? "yes" : "no"); }
function choiceOf(list: string[]): string { let s = ""; for (const x of list) { try { s += (["a", "b"].includes(x) ? "yes" : "no") + " "; } catch (e) { s += "!"; } } return s; }
function choiceCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if ((["a", "b"].includes(x) ? "yes" : "") !== "") n += i; else n--; } return n; }
function infiniteOnce(x: number): any { return [Infinity, 2147483648, 9007199254740992].includes(x); }
function infiniteOf(list: number[]): string { let s = ""; for (const x of list) { try { s += [Infinity, 2147483648, 9007199254740992].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function infiniteCount(list: number[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if ([Infinity, 2147483648, 9007199254740992].includes(x)) n += i; else n--; } return n; }
function sameOnce(x: string): any { return ["a", "a"].includes(x); }
function sameOf(list: string[]): string { let s = ""; for (const x of list) { try { s += ["a", "a"].includes(x) + " "; } catch (e) { s += "!"; } } return s; }
function sameCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (["a", "a"].includes(x)) n += i; else n--; } return n; }
function sumOnce(x: string): any { return ["g1", "g3"].includes("g" + x); }
function sumOf(list: string[]): string { let s = ""; for (const x of list) { try { s += ["g1", "g3"].includes("g" + x) + " "; } catch (e) { s += "!"; } } return s; }
function sumCount(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (["g1", "g3"].includes("g" + x)) n += i; else n--; } return n; }
function kinds(rows: Row[]): string { let s = ""; for (const r of rows) { if (["g1", "g3"].includes(r.kind)) s += r.id; else if (!["a", "b"].includes(r.kind)) s += "-"; if ([1, 2, 5].includes(r.id)) s += "i"; switch (true) { case ["longer text here"].includes(r.name): s += "L"; } } return s; }
function narrowed(x: Kind | number | null): string { if (["g1", "g3"].includes(x as Kind)) return "text"; if ([1, 5].includes(x as number)) return "number"; return x === null ? "null" : "other"; }
for (const x of sought) { let r; try { r = textsOnce(x); } catch (e) { r = "!"; } say("texts " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([textsOf(l), (() => { try { return textsCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = oneOnce(x); } catch (e) { r = "!"; } say("one " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([oneOf(l), (() => { try { return oneCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = emptyOnce(x); } catch (e) { r = "!"; } say("empty " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([emptyOf(l), (() => { try { return emptyCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = numbersOnce(x); } catch (e) { r = "!"; } say("numbers " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([numbersOf(l), (() => { try { return numbersCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = zerosOnce(x); } catch (e) { r = "!"; } say("zeros " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([zerosOf(l), (() => { try { return zerosCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = doublesOnce(x); } catch (e) { r = "!"; } say("doubles " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([doublesOf(l), (() => { try { return doublesCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = truthsOnce(x); } catch (e) { r = "!"; } say("truths " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([truthsOf(l), (() => { try { return truthsCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = wideOnce(x); } catch (e) { r = "!"; } say("wide " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([wideOf(l), (() => { try { return wideCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = longOnce(x); } catch (e) { r = "!"; } say("long " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([longOf(l), (() => { try { return longCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = eightOnce(x); } catch (e) { r = "!"; } say("eight " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([eightOf(l), (() => { try { return eightCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = nineOnce(x); } catch (e) { r = "!"; } say("nine " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([nineOf(l), (() => { try { return nineCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = twelveOnce(x); } catch (e) { r = "!"; } say("twelve " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([twelveOf(l), (() => { try { return twelveCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = thirteenOnce(x); } catch (e) { r = "!"; } say("thirteen " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([thirteenOf(l), (() => { try { return thirteenCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = indexOfOnce(x); } catch (e) { r = "!"; } say("indexOf " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([indexOfOf(l), (() => { try { return indexOfCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = notIncludedOnce(x); } catch (e) { r = "!"; } say("notIncluded " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([notIncludedOf(l), (() => { try { return notIncludedCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = choiceOnce(x); } catch (e) { r = "!"; } say("choice " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([choiceOf(l), (() => { try { return choiceCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = infiniteOnce(x); } catch (e) { r = "!"; } say("infinite " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([infiniteOf(l), (() => { try { return infiniteCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = sameOnce(x); } catch (e) { r = "!"; } say("same " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([sameOf(l), (() => { try { return sameCount(l); } catch (e) { return "!"; } })()].join());
for (const x of sought) { let r; try { r = sumOnce(x); } catch (e) { r = "!"; } say("sum " + r); } for (const l of [sought, values, sought.filter(x => typeof x === "string"), sought.filter(x => typeof x === "number"), []]) say([sumOf(l), (() => { try { return sumCount(l); } catch (e) { return "!"; } })()].join());
say(kinds(sought.map((kind, i) => ({ kind, id: i, name: sought[(i * 7) % sought.length] })))); for (const x of sought) say(narrowed(x)); console.log("lines", lines, hash);
