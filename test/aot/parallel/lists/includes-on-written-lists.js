// [..].includes(x) and its neighbors, outside loops and in them, for elements and operands of every kind.
// STATISTIC: MembershipsComparedInline >= 100
const values = JSON.parse('["", "a", "b", "ab", "g1", "g3", "longer text here", 0, 1, 2, 5, 9, -1, 0.5, null, true, false, "1", "true", "null", "日本", "é"]');
const zero = values[7], half = values[13], text = "xx g1 g3 ab longer text here 日本";
const sought = [...values, undefined, zero / zero, -zero, 2 ** 31, 2 ** 53, 1e300, Infinity, text.slice(3, 5), text.slice(6, 8), "g" + values[8], values[1] + values[2], text.slice(12, 28), text.slice(29), { toString: () => "a" }, ["a"], 1n, Symbol.iterator, () => 1];
const all = process.argv[2] === "all"; let lines = 0, hash = 0;
function say(line) { lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (all) console.log(line); else if (lines % 23 === 0) console.log(lines, hash); }
function texts_once(x) { return ["g1", "g3", "g5"].includes(x); }
function texts_of(list) { let s = ""; for (const x of list) { try { s += ["g1", "g3", "g5"].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function texts_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["g1", "g3", "g5"].includes(x)); } return s.join(); }
function texts_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["g1", "g3", "g5"].includes(x)) n += i; else n -= 1; } return n; }
function texts_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["g1", "g3", "g5"].includes(x)) n += i; }); return n; }
function one_once(x) { return ["a"].includes(x); }
function one_of(list) { let s = ""; for (const x of list) { try { s += ["a"].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function one_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a"].includes(x)); } return s.join(); }
function one_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a"].includes(x)) n += i; else n -= 1; } return n; }
function one_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a"].includes(x)) n += i; }); return n; }
function none_once(x) { return [].includes(x); }
function none_of(list) { let s = ""; for (const x of list) { try { s += [].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function none_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([].includes(x)); } return s.join(); }
function none_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([].includes(x)) n += i; else n -= 1; } return n; }
function none_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [].includes(x)) n += i; }); return n; }
function empty_once(x) { return ["", "a"].includes(x); }
function empty_of(list) { let s = ""; for (const x of list) { try { s += ["", "a"].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function empty_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["", "a"].includes(x)); } return s.join(); }
function empty_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["", "a"].includes(x)) n += i; else n -= 1; } return n; }
function empty_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["", "a"].includes(x)) n += i; }); return n; }
function numbers_once(x) { return [1, 5, 9].includes(x); }
function numbers_of(list) { let s = ""; for (const x of list) { try { s += [1, 5, 9].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function numbers_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([1, 5, 9].includes(x)); } return s.join(); }
function numbers_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([1, 5, 9].includes(x)) n += i; else n -= 1; } return n; }
function numbers_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [1, 5, 9].includes(x)) n += i; }); return n; }
function zeros_once(x) { return [0, -1].includes(x); }
function zeros_of(list) { let s = ""; for (const x of list) { try { s += [0, -1].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function zeros_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([0, -1].includes(x)); } return s.join(); }
function zeros_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([0, -1].includes(x)) n += i; else n -= 1; } return n; }
function zeros_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [0, -1].includes(x)) n += i; }); return n; }
function minusZero_once(x) { return [-0].includes(x); }
function minusZero_of(list) { let s = ""; for (const x of list) { try { s += [-0].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function minusZero_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([-0].includes(x)); } return s.join(); }
function minusZero_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([-0].includes(x)) n += i; else n -= 1; } return n; }
function minusZero_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [-0].includes(x)) n += i; }); return n; }
function doubles_once(x) { return [0.5, 1.5, 1e300].includes(x); }
function doubles_of(list) { let s = ""; for (const x of list) { try { s += [0.5, 1.5, 1e300].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function doubles_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([0.5, 1.5, 1e300].includes(x)); } return s.join(); }
function doubles_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([0.5, 1.5, 1e300].includes(x)) n += i; else n -= 1; } return n; }
function doubles_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [0.5, 1.5, 1e300].includes(x)) n += i; }); return n; }
function nans_once(x) { return [NaN, 1].includes(x); }
function nans_of(list) { let s = ""; for (const x of list) { try { s += [NaN, 1].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function nans_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([NaN, 1].includes(x)); } return s.join(); }
function nans_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([NaN, 1].includes(x)) n += i; else n -= 1; } return n; }
function nans_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [NaN, 1].includes(x)) n += i; }); return n; }
function computedNaN_once(x) { return [0 / 0, 1].includes(x); }
function computedNaN_of(list) { let s = ""; for (const x of list) { try { s += [0 / 0, 1].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function computedNaN_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([0 / 0, 1].includes(x)); } return s.join(); }
function computedNaN_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([0 / 0, 1].includes(x)) n += i; else n -= 1; } return n; }
function computedNaN_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [0 / 0, 1].includes(x)) n += i; }); return n; }
function mixed_once(x) { return ["a", 1, null, undefined, true].includes(x); }
function mixed_of(list) { let s = ""; for (const x of list) { try { s += ["a", 1, null, undefined, true].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function mixed_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a", 1, null, undefined, true].includes(x)); } return s.join(); }
function mixed_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a", 1, null, undefined, true].includes(x)) n += i; else n -= 1; } return n; }
function mixed_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a", 1, null, undefined, true].includes(x)) n += i; }); return n; }
function truths_once(x) { return [true, false].includes(x); }
function truths_of(list) { let s = ""; for (const x of list) { try { s += [true, false].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function truths_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([true, false].includes(x)); } return s.join(); }
function truths_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([true, false].includes(x)) n += i; else n -= 1; } return n; }
function truths_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [true, false].includes(x)) n += i; }); return n; }
function holes_once(x) { return ["a", , "b"].includes(x); }
function holes_of(list) { let s = ""; for (const x of list) { try { s += ["a", , "b"].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function holes_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a", , "b"].includes(x)); } return s.join(); }
function holes_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a", , "b"].includes(x)) n += i; else n -= 1; } return n; }
function holes_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a", , "b"].includes(x)) n += i; }); return n; }
function onlyHoles_once(x) { return [, ,].includes(x); }
function onlyHoles_of(list) { let s = ""; for (const x of list) { try { s += [, ,].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function onlyHoles_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([, ,].includes(x)); } return s.join(); }
function onlyHoles_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([, ,].includes(x)) n += i; else n -= 1; } return n; }
function onlyHoles_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [, ,].includes(x)) n += i; }); return n; }
function nothing_once(x) { return [undefined].includes(x); }
function nothing_of(list) { let s = ""; for (const x of list) { try { s += [undefined].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function nothing_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([undefined].includes(x)); } return s.join(); }
function nothing_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([undefined].includes(x)) n += i; else n -= 1; } return n; }
function nothing_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [undefined].includes(x)) n += i; }); return n; }
function nulls_once(x) { return [null].includes(x); }
function nulls_of(list) { let s = ""; for (const x of list) { try { s += [null].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function nulls_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([null].includes(x)); } return s.join(); }
function nulls_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([null].includes(x)) n += i; else n -= 1; } return n; }
function nulls_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [null].includes(x)) n += i; }); return n; }
function wide_once(x) { return ["日本", "é"].includes(x); }
function wide_of(list) { let s = ""; for (const x of list) { try { s += ["日本", "é"].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function wide_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["日本", "é"].includes(x)); } return s.join(); }
function wide_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["日本", "é"].includes(x)) n += i; else n -= 1; } return n; }
function wide_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["日本", "é"].includes(x)) n += i; }); return n; }
function long_once(x) { return ["longer text here", "another longer text"].includes(x); }
function long_of(list) { let s = ""; for (const x of list) { try { s += ["longer text here", "another longer text"].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function long_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["longer text here", "another longer text"].includes(x)); } return s.join(); }
function long_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["longer text here", "another longer text"].includes(x)) n += i; else n -= 1; } return n; }
function long_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["longer text here", "another longer text"].includes(x)) n += i; }); return n; }
function eight_once(x) { return ["a", "b", "c", "d", "e", "f", "g1", "h"].includes(x); }
function eight_of(list) { let s = ""; for (const x of list) { try { s += ["a", "b", "c", "d", "e", "f", "g1", "h"].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function eight_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a", "b", "c", "d", "e", "f", "g1", "h"].includes(x)); } return s.join(); }
function eight_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a", "b", "c", "d", "e", "f", "g1", "h"].includes(x)) n += i; else n -= 1; } return n; }
function eight_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a", "b", "c", "d", "e", "f", "g1", "h"].includes(x)) n += i; }); return n; }
function nine_once(x) { return ["a", "b", "c", "d", "e", "f", "g1", "h", "g3"].includes(x); }
function nine_of(list) { let s = ""; for (const x of list) { try { s += ["a", "b", "c", "d", "e", "f", "g1", "h", "g3"].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function nine_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a", "b", "c", "d", "e", "f", "g1", "h", "g3"].includes(x)); } return s.join(); }
function nine_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a", "b", "c", "d", "e", "f", "g1", "h", "g3"].includes(x)) n += i; else n -= 1; } return n; }
function nine_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a", "b", "c", "d", "e", "f", "g1", "h", "g3"].includes(x)) n += i; }); return n; }
function twelve_once(x) { return ["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "g3"].includes(x); }
function twelve_of(list) { let s = ""; for (const x of list) { try { s += ["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "g3"].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function twelve_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "g3"].includes(x)); } return s.join(); }
function twelve_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "g3"].includes(x)) n += i; else n -= 1; } return n; }
function twelve_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "g3"].includes(x)) n += i; }); return n; }
function thirteen_once(x) { return ["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "l", "g3"].includes(x); }
function thirteen_of(list) { let s = ""; for (const x of list) { try { s += ["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "l", "g3"].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function thirteen_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "l", "g3"].includes(x)); } return s.join(); }
function thirteen_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "l", "g3"].includes(x)) n += i; else n -= 1; } return n; }
function thirteen_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a", "b", "c", "d", "e", "f", "g1", "h", "i", "j", "k", "l", "g3"].includes(x)) n += i; }); return n; }
function from_once(x) { return ["a", "b", "ab"].includes(x, 1); }
function from_of(list) { let s = ""; for (const x of list) { try { s += ["a", "b", "ab"].includes(x, 1) + " "; } catch (e) { s += e.name; } } return s; }
function from_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a", "b", "ab"].includes(x, 1)); } return s.join(); }
function from_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a", "b", "ab"].includes(x, 1)) n += i; else n -= 1; } return n; }
function from_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a", "b", "ab"].includes(x, 1)) n += i; }); return n; }
function fromEnd_once(x) { return ["a", "b", "ab"].includes(x, -1); }
function fromEnd_of(list) { let s = ""; for (const x of list) { try { s += ["a", "b", "ab"].includes(x, -1) + " "; } catch (e) { s += e.name; } } return s; }
function fromEnd_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a", "b", "ab"].includes(x, -1)); } return s.join(); }
function fromEnd_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a", "b", "ab"].includes(x, -1)) n += i; else n -= 1; } return n; }
function fromEnd_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a", "b", "ab"].includes(x, -1)) n += i; }); return n; }
function fromNothing_once(x) { return ["a", "b"].includes(x, undefined); }
function fromNothing_of(list) { let s = ""; for (const x of list) { try { s += ["a", "b"].includes(x, undefined) + " "; } catch (e) { s += e.name; } } return s; }
function fromNothing_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a", "b"].includes(x, undefined)); } return s.join(); }
function fromNothing_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a", "b"].includes(x, undefined)) n += i; else n -= 1; } return n; }
function fromNothing_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a", "b"].includes(x, undefined)) n += i; }); return n; }
function more_once(x) { return ["a", "b"].includes(x, 0, 1); }
function more_of(list) { let s = ""; for (const x of list) { try { s += ["a", "b"].includes(x, 0, 1) + " "; } catch (e) { s += e.name; } } return s; }
function more_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a", "b"].includes(x, 0, 1)); } return s.join(); }
function more_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a", "b"].includes(x, 0, 1)) n += i; else n -= 1; } return n; }
function more_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a", "b"].includes(x, 0, 1)) n += i; }); return n; }
function same_once(x) { return ["a", "a"].includes(x); }
function same_of(list) { let s = ""; for (const x of list) { try { s += ["a", "a"].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function same_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a", "a"].includes(x)); } return s.join(); }
function same_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a", "a"].includes(x)) n += i; else n -= 1; } return n; }
function same_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a", "a"].includes(x)) n += i; }); return n; }
function infinite_once(x) { return [Infinity, 2147483648, 9007199254740992].includes(x); }
function infinite_of(list) { let s = ""; for (const x of list) { try { s += [Infinity, 2147483648, 9007199254740992].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function infinite_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([Infinity, 2147483648, 9007199254740992].includes(x)); } return s.join(); }
function infinite_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([Infinity, 2147483648, 9007199254740992].includes(x)) n += i; else n -= 1; } return n; }
function infinite_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [Infinity, 2147483648, 9007199254740992].includes(x)) n += i; }); return n; }
function indexOf_once(x) { return ["g1", "g3", "g5"].indexOf(x); }
function indexOf_of(list) { let s = ""; for (const x of list) { try { s += ["g1", "g3", "g5"].indexOf(x) + " "; } catch (e) { s += e.name; } } return s; }
function indexOf_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["g1", "g3", "g5"].indexOf(x)); } return s.join(); }
function indexOf_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["g1", "g3", "g5"].indexOf(x)) n += i; else n -= 1; } return n; }
function indexOf_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["g1", "g3", "g5"].indexOf(x)) n += i; }); return n; }
function notIncluded_once(x) { return !["g1", "g3"].includes(x); }
function notIncluded_of(list) { let s = ""; for (const x of list) { try { s += !["g1", "g3"].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function notIncluded_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(!["g1", "g3"].includes(x)); } return s.join(); }
function notIncluded_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (!["g1", "g3"].includes(x)) n += i; else n -= 1; } return n; }
function notIncluded_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && !["g1", "g3"].includes(x)) n += i; }); return n; }
function both_once(x) { return ["g1", "a"].includes(x) && ["a", 1].includes(x); }
function both_of(list) { let s = ""; for (const x of list) { try { s += ["g1", "a"].includes(x) && ["a", 1].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function both_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["g1", "a"].includes(x) && ["a", 1].includes(x)); } return s.join(); }
function both_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["g1", "a"].includes(x) && ["a", 1].includes(x)) n += i; else n -= 1; } return n; }
function both_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["g1", "a"].includes(x) && ["a", 1].includes(x)) n += i; }); return n; }
function either_once(x) { return ["g1"].includes(x) || [5].includes(x); }
function either_of(list) { let s = ""; for (const x of list) { try { s += ["g1"].includes(x) || [5].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function either_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["g1"].includes(x) || [5].includes(x)); } return s.join(); }
function either_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["g1"].includes(x) || [5].includes(x)) n += i; else n -= 1; } return n; }
function either_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["g1"].includes(x) || [5].includes(x)) n += i; }); return n; }
function choice_once(x) { return (["a", "b"].includes(x) ? "yes" : "no"); }
function choice_of(list) { let s = ""; for (const x of list) { try { s += (["a", "b"].includes(x) ? "yes" : "no") + " "; } catch (e) { s += e.name; } } return s; }
function choice_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push((["a", "b"].includes(x) ? "yes" : "no")); } return s.join(); }
function choice_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ((["a", "b"].includes(x) ? "yes" : "no")) n += i; else n -= 1; } return n; }
function choice_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && (["a", "b"].includes(x) ? "yes" : "no")) n += i; }); return n; }
function big_once(x) { return [1n, 2n].includes(x); }
function big_of(list) { let s = ""; for (const x of list) { try { s += [1n, 2n].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function big_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([1n, 2n].includes(x)); } return s.join(); }
function big_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([1n, 2n].includes(x)) n += i; else n -= 1; } return n; }
function big_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [1n, 2n].includes(x)) n += i; }); return n; }
function values_once(x) { return [values[1], values[4], zero].includes(x); }
function values_of(list) { let s = ""; for (const x of list) { try { s += [values[1], values[4], zero].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function values_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([values[1], values[4], zero].includes(x)); } return s.join(); }
function values_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([values[1], values[4], zero].includes(x)) n += i; else n -= 1; } return n; }
function values_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [values[1], values[4], zero].includes(x)) n += i; }); return n; }
function spread_once(x) { return [...values].includes(x); }
function spread_of(list) { let s = ""; for (const x of list) { try { s += [...values].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function spread_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([...values].includes(x)); } return s.join(); }
function spread_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([...values].includes(x)) n += i; else n -= 1; } return n; }
function spread_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [...values].includes(x)) n += i; }); return n; }
function nested_once(x) { return [["a"], "b"].includes(x); }
function nested_of(list) { let s = ""; for (const x of list) { try { s += [["a"], "b"].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function nested_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([["a"], "b"].includes(x)); } return s.join(); }
function nested_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([["a"], "b"].includes(x)) n += i; else n -= 1; } return n; }
function nested_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [["a"], "b"].includes(x)) n += i; }); return n; }
function self_once(x) { return [x].includes(x); }
function self_of(list) { let s = ""; for (const x of list) { try { s += [x].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function self_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push([x].includes(x)); } return s.join(); }
function self_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ([x].includes(x)) n += i; else n -= 1; } return n; }
function self_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && [x].includes(x)) n += i; }); return n; }
function other_once(x) { return ["a", x].includes(x); }
function other_of(list) { let s = ""; for (const x of list) { try { s += ["a", x].includes(x) + " "; } catch (e) { s += e.name; } } return s; }
function other_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a", x].includes(x)); } return s.join(); }
function other_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a", x].includes(x)) n += i; else n -= 1; } return n; }
function other_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a", x].includes(x)) n += i; }); return n; }
function noArgument_once(x) { return ["a", undefined].includes(); }
function noArgument_of(list) { let s = ""; for (const x of list) { try { s += ["a", undefined].includes() + " "; } catch (e) { s += e.name; } } return s; }
function noArgument_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["a", undefined].includes()); } return s.join(); }
function noArgument_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["a", undefined].includes()) n += i; else n -= 1; } return n; }
function noArgument_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["a", undefined].includes()) n += i; }); return n; }
function sum_once(x) { return ["g1", "g3"].includes("g" + x); }
function sum_of(list) { let s = ""; for (const x of list) { try { s += ["g1", "g3"].includes("g" + x) + " "; } catch (e) { s += e.name; } } return s; }
function sum_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push(["g1", "g3"].includes("g" + x)); } return s.join(); }
function sum_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if (["g1", "g3"].includes("g" + x)) n += i; else n -= 1; } return n; }
function sum_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && ["g1", "g3"].includes("g" + x)) n += i; }); return n; }
function kept_once(x) { return (l => l.includes(x) && l.push(x) && l.includes(x) && l.length)(["a", "g1"]); }
function kept_of(list) { let s = ""; for (const x of list) { try { s += (l => l.includes(x) && l.push(x) && l.includes(x) && l.length)(["a", "g1"]) + " "; } catch (e) { s += e.name; } } return s; }
function kept_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push((l => l.includes(x) && l.push(x) && l.includes(x) && l.length)(["a", "g1"])); } return s.join(); }
function kept_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ((l => l.includes(x) && l.push(x) && l.includes(x) && l.length)(["a", "g1"])) n += i; else n -= 1; } return n; }
function kept_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && (l => l.includes(x) && l.push(x) && l.includes(x) && l.length)(["a", "g1"])) n += i; }); return n; }
function changed_once(x) { return (l => { l[0] = x; return l.includes("a") + "" + l.includes(x); })(["a", "b"]); }
function changed_of(list) { let s = ""; for (const x of list) { try { s += (l => { l[0] = x; return l.includes("a") + "" + l.includes(x); })(["a", "b"]) + " "; } catch (e) { s += e.name; } } return s; }
function changed_at(list) { const s = []; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol" || (typeof x === "object" && x)) continue; s.push((l => { l[0] = x; return l.includes("a") + "" + l.includes(x); })(["a", "b"])); } return s.join(); }
function changed_count(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "symbol") continue; if ((l => { l[0] = x; return l.includes("a") + "" + l.includes(x); })(["a", "b"])) n += i; else n -= 1; } return n; }
function changed_each(list) { let n = 0; list.forEach((x, i) => { if (typeof x !== "symbol" && (l => { l[0] = x; return l.includes("a") + "" + l.includes(x); })(["a", "b"])) n += i; }); return n; }
const strings = sought.filter(x => typeof x === "string"), numbers = sought.filter(x => typeof x === "number"), lists = [sought, values, strings, numbers, [], new Array(3), text.split(" ")];
for (const x of sought) { let r; try { r = texts_once(x); } catch (e) { r = e.name; } say("texts " + r); } for (const l of lists) say([texts_of(l), texts_at(l), texts_count(l), texts_each(l)].join(" | "));
for (const x of sought) { let r; try { r = one_once(x); } catch (e) { r = e.name; } say("one " + r); } for (const l of lists) say([one_of(l), one_at(l), one_count(l), one_each(l)].join(" | "));
for (const x of sought) { let r; try { r = none_once(x); } catch (e) { r = e.name; } say("none " + r); } for (const l of lists) say([none_of(l), none_at(l), none_count(l), none_each(l)].join(" | "));
for (const x of sought) { let r; try { r = empty_once(x); } catch (e) { r = e.name; } say("empty " + r); } for (const l of lists) say([empty_of(l), empty_at(l), empty_count(l), empty_each(l)].join(" | "));
for (const x of sought) { let r; try { r = numbers_once(x); } catch (e) { r = e.name; } say("numbers " + r); } for (const l of lists) say([numbers_of(l), numbers_at(l), numbers_count(l), numbers_each(l)].join(" | "));
for (const x of sought) { let r; try { r = zeros_once(x); } catch (e) { r = e.name; } say("zeros " + r); } for (const l of lists) say([zeros_of(l), zeros_at(l), zeros_count(l), zeros_each(l)].join(" | "));
for (const x of sought) { let r; try { r = minusZero_once(x); } catch (e) { r = e.name; } say("minusZero " + r); } for (const l of lists) say([minusZero_of(l), minusZero_at(l), minusZero_count(l), minusZero_each(l)].join(" | "));
for (const x of sought) { let r; try { r = doubles_once(x); } catch (e) { r = e.name; } say("doubles " + r); } for (const l of lists) say([doubles_of(l), doubles_at(l), doubles_count(l), doubles_each(l)].join(" | "));
for (const x of sought) { let r; try { r = nans_once(x); } catch (e) { r = e.name; } say("nans " + r); } for (const l of lists) say([nans_of(l), nans_at(l), nans_count(l), nans_each(l)].join(" | "));
for (const x of sought) { let r; try { r = computedNaN_once(x); } catch (e) { r = e.name; } say("computedNaN " + r); } for (const l of lists) say([computedNaN_of(l), computedNaN_at(l), computedNaN_count(l), computedNaN_each(l)].join(" | "));
for (const x of sought) { let r; try { r = mixed_once(x); } catch (e) { r = e.name; } say("mixed " + r); } for (const l of lists) say([mixed_of(l), mixed_at(l), mixed_count(l), mixed_each(l)].join(" | "));
for (const x of sought) { let r; try { r = truths_once(x); } catch (e) { r = e.name; } say("truths " + r); } for (const l of lists) say([truths_of(l), truths_at(l), truths_count(l), truths_each(l)].join(" | "));
for (const x of sought) { let r; try { r = holes_once(x); } catch (e) { r = e.name; } say("holes " + r); } for (const l of lists) say([holes_of(l), holes_at(l), holes_count(l), holes_each(l)].join(" | "));
for (const x of sought) { let r; try { r = onlyHoles_once(x); } catch (e) { r = e.name; } say("onlyHoles " + r); } for (const l of lists) say([onlyHoles_of(l), onlyHoles_at(l), onlyHoles_count(l), onlyHoles_each(l)].join(" | "));
for (const x of sought) { let r; try { r = nothing_once(x); } catch (e) { r = e.name; } say("nothing " + r); } for (const l of lists) say([nothing_of(l), nothing_at(l), nothing_count(l), nothing_each(l)].join(" | "));
for (const x of sought) { let r; try { r = nulls_once(x); } catch (e) { r = e.name; } say("nulls " + r); } for (const l of lists) say([nulls_of(l), nulls_at(l), nulls_count(l), nulls_each(l)].join(" | "));
for (const x of sought) { let r; try { r = wide_once(x); } catch (e) { r = e.name; } say("wide " + r); } for (const l of lists) say([wide_of(l), wide_at(l), wide_count(l), wide_each(l)].join(" | "));
for (const x of sought) { let r; try { r = long_once(x); } catch (e) { r = e.name; } say("long " + r); } for (const l of lists) say([long_of(l), long_at(l), long_count(l), long_each(l)].join(" | "));
for (const x of sought) { let r; try { r = eight_once(x); } catch (e) { r = e.name; } say("eight " + r); } for (const l of lists) say([eight_of(l), eight_at(l), eight_count(l), eight_each(l)].join(" | "));
for (const x of sought) { let r; try { r = nine_once(x); } catch (e) { r = e.name; } say("nine " + r); } for (const l of lists) say([nine_of(l), nine_at(l), nine_count(l), nine_each(l)].join(" | "));
for (const x of sought) { let r; try { r = twelve_once(x); } catch (e) { r = e.name; } say("twelve " + r); } for (const l of lists) say([twelve_of(l), twelve_at(l), twelve_count(l), twelve_each(l)].join(" | "));
for (const x of sought) { let r; try { r = thirteen_once(x); } catch (e) { r = e.name; } say("thirteen " + r); } for (const l of lists) say([thirteen_of(l), thirteen_at(l), thirteen_count(l), thirteen_each(l)].join(" | "));
for (const x of sought) { let r; try { r = from_once(x); } catch (e) { r = e.name; } say("from " + r); } for (const l of lists) say([from_of(l), from_at(l), from_count(l), from_each(l)].join(" | "));
for (const x of sought) { let r; try { r = fromEnd_once(x); } catch (e) { r = e.name; } say("fromEnd " + r); } for (const l of lists) say([fromEnd_of(l), fromEnd_at(l), fromEnd_count(l), fromEnd_each(l)].join(" | "));
for (const x of sought) { let r; try { r = fromNothing_once(x); } catch (e) { r = e.name; } say("fromNothing " + r); } for (const l of lists) say([fromNothing_of(l), fromNothing_at(l), fromNothing_count(l), fromNothing_each(l)].join(" | "));
for (const x of sought) { let r; try { r = more_once(x); } catch (e) { r = e.name; } say("more " + r); } for (const l of lists) say([more_of(l), more_at(l), more_count(l), more_each(l)].join(" | "));
for (const x of sought) { let r; try { r = same_once(x); } catch (e) { r = e.name; } say("same " + r); } for (const l of lists) say([same_of(l), same_at(l), same_count(l), same_each(l)].join(" | "));
for (const x of sought) { let r; try { r = infinite_once(x); } catch (e) { r = e.name; } say("infinite " + r); } for (const l of lists) say([infinite_of(l), infinite_at(l), infinite_count(l), infinite_each(l)].join(" | "));
for (const x of sought) { let r; try { r = indexOf_once(x); } catch (e) { r = e.name; } say("indexOf " + r); } for (const l of lists) say([indexOf_of(l), indexOf_at(l), indexOf_count(l), indexOf_each(l)].join(" | "));
for (const x of sought) { let r; try { r = notIncluded_once(x); } catch (e) { r = e.name; } say("notIncluded " + r); } for (const l of lists) say([notIncluded_of(l), notIncluded_at(l), notIncluded_count(l), notIncluded_each(l)].join(" | "));
for (const x of sought) { let r; try { r = both_once(x); } catch (e) { r = e.name; } say("both " + r); } for (const l of lists) say([both_of(l), both_at(l), both_count(l), both_each(l)].join(" | "));
for (const x of sought) { let r; try { r = either_once(x); } catch (e) { r = e.name; } say("either " + r); } for (const l of lists) say([either_of(l), either_at(l), either_count(l), either_each(l)].join(" | "));
for (const x of sought) { let r; try { r = choice_once(x); } catch (e) { r = e.name; } say("choice " + r); } for (const l of lists) say([choice_of(l), choice_at(l), choice_count(l), choice_each(l)].join(" | "));
for (const x of sought) { let r; try { r = big_once(x); } catch (e) { r = e.name; } say("big " + r); } for (const l of lists) say([big_of(l), big_at(l), big_count(l), big_each(l)].join(" | "));
for (const x of sought) { let r; try { r = values_once(x); } catch (e) { r = e.name; } say("values " + r); } for (const l of lists) say([values_of(l), values_at(l), values_count(l), values_each(l)].join(" | "));
for (const x of sought) { let r; try { r = spread_once(x); } catch (e) { r = e.name; } say("spread " + r); } for (const l of lists) say([spread_of(l), spread_at(l), spread_count(l), spread_each(l)].join(" | "));
for (const x of sought) { let r; try { r = nested_once(x); } catch (e) { r = e.name; } say("nested " + r); } for (const l of lists) say([nested_of(l), nested_at(l), nested_count(l), nested_each(l)].join(" | "));
for (const x of sought) { let r; try { r = self_once(x); } catch (e) { r = e.name; } say("self " + r); } for (const l of lists) say([self_of(l), self_at(l), self_count(l), self_each(l)].join(" | "));
for (const x of sought) { let r; try { r = other_once(x); } catch (e) { r = e.name; } say("other " + r); } for (const l of lists) say([other_of(l), other_at(l), other_count(l), other_each(l)].join(" | "));
for (const x of sought) { let r; try { r = noArgument_once(x); } catch (e) { r = e.name; } say("noArgument " + r); } for (const l of lists) say([noArgument_of(l), noArgument_at(l), noArgument_count(l), noArgument_each(l)].join(" | "));
for (const x of sought) { let r; try { r = sum_once(x); } catch (e) { r = e.name; } say("sum " + r); } for (const l of lists) say([sum_of(l), sum_at(l), sum_count(l), sum_each(l)].join(" | "));
for (const x of sought) { let r; try { r = kept_once(x); } catch (e) { r = e.name; } say("kept " + r); } for (const l of lists) say([kept_of(l), kept_at(l), kept_count(l), kept_each(l)].join(" | "));
for (const x of sought) { let r; try { r = changed_once(x); } catch (e) { r = e.name; } say("changed " + r); } for (const l of lists) say([changed_of(l), changed_at(l), changed_count(l), changed_each(l)].join(" | "));
function fields(rows) { let s = 0; for (const r of rows) { if (["g1", "g3"].includes(r.group)) s += r.id; if (["x", "y"].includes(r.kind)) s += 1000; if ([1, 2, 3].includes(r.id)) s += 100000; } return s; }
say(String(fields(sought.map((group, id) => ({ group, id, kind: id & 1 ? "x" : group })))));
let reads = 0; const getter = { get group() { reads++; return "g3"; } }; say(String(fields([getter, { group: "g1", id: 1 }])) + reads);
function leave(list) { let i = 0; while (i < list.length && !["longer text here", 9].includes(list[i])) i++; return i; } for (const l of lists) say(String(leave(l)));
function thrown(list) { let n = 0; for (const x of list) { try { if (["a", "b"].includes(x)) throw x; } catch (y) { n += y.length; } finally { n++; } } return n; } for (const l of lists) say(String(thrown(l)));
console.log("lines", lines, hash);
