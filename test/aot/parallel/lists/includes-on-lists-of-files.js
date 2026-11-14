// Lists that variables hold, changed in every way: includes() in loops.
const values = JSON.parse('["", "a", "b", "ab", "g1", "g2", "g3", "g9", "longer text here", 0, 1, 2, 5, 9, -1, 0.5, 1.5, null, true, false, "1", "true", "null", "日本", "é"]');
const zero = values[9], text = "xx g1 g3 ab longer text here 日本";
const strings = values.filter(x => typeof x === "string").concat([text.slice(3, 5), text.slice(6, 8), "g" + values[10], values[1] + values[2], text.slice(12, 28), text.slice(29), "g" + values[12]]);
const numbers = values.filter(x => typeof x === "number").concat([zero / zero, -zero, 2 ** 31, 2 ** 53, 1e300, Infinity]);
const sought = [...strings, ...numbers, undefined, null, true, { toString: () => "a" }, ["a"], 1n, Symbol.iterator, () => 1];
let lines = 0, hash = 0;
function say(line) { lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (lines % 23 === 0) console.log(lines, hash); }
const L_texts_kept = ["g1", "g3", "g5"];
function texts_kept_change() { ; }
function texts_kept_of(list) { let s = ""; for (const x of list) s += L_texts_kept.includes(x) ? 1 : 0; return s; }
function texts_kept_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_kept.includes(list[i])) h += i; else h -= 1; return h; }
function texts_kept_filter(list) { return list.filter(x => L_texts_kept.includes(x)).length; }
function texts_kept_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_kept.includes(x)) continue; s += i; } return s; }
function texts_kept_second(list) { let s = ""; for (const x of list) s += (L_texts_kept.includes(x, 1) ? 1 : 0) + (L_texts_kept.includes(x, -1) ? 2 : 0) + (L_texts_kept.includes() ? 4 : 0) + (L_texts_kept?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_kept, x) ? 16 : 0); return s; }
function texts_kept_once(x) { return L_texts_kept.includes(x); }
function texts_kept_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_kept_change(); } catch (e) { s += e.name; } } s += L_texts_kept.includes(list[i]) ? 1 : 0; } return s; }
function texts_kept_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { ; } catch (e) { s += e.name; } } s += L_texts_kept.includes(list[i]) ? 1 : 0; s += L_texts_kept.length; } return s; }
const L_texts_pushed = ["g1", "g3", "g5"];
function texts_pushed_change() { L_texts_pushed.push("g9", 2); }
function texts_pushed_of(list) { let s = ""; for (const x of list) s += L_texts_pushed.includes(x) ? 1 : 0; return s; }
function texts_pushed_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_pushed.includes(list[i])) h += i; else h -= 1; return h; }
function texts_pushed_filter(list) { return list.filter(x => L_texts_pushed.includes(x)).length; }
function texts_pushed_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_pushed.includes(x)) continue; s += i; } return s; }
function texts_pushed_second(list) { let s = ""; for (const x of list) s += (L_texts_pushed.includes(x, 1) ? 1 : 0) + (L_texts_pushed.includes(x, -1) ? 2 : 0) + (L_texts_pushed.includes() ? 4 : 0) + (L_texts_pushed?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_pushed, x) ? 16 : 0); return s; }
function texts_pushed_once(x) { return L_texts_pushed.includes(x); }
function texts_pushed_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_pushed_change(); } catch (e) { s += e.name; } } s += L_texts_pushed.includes(list[i]) ? 1 : 0; } return s; }
function texts_pushed_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_pushed.push("g9", 2); } catch (e) { s += e.name; } } s += L_texts_pushed.includes(list[i]) ? 1 : 0; s += L_texts_pushed.length; } return s; }
const L_texts_popped = ["g1", "g3", "g5"];
function texts_popped_change() { L_texts_popped.pop(); }
function texts_popped_of(list) { let s = ""; for (const x of list) s += L_texts_popped.includes(x) ? 1 : 0; return s; }
function texts_popped_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_popped.includes(list[i])) h += i; else h -= 1; return h; }
function texts_popped_filter(list) { return list.filter(x => L_texts_popped.includes(x)).length; }
function texts_popped_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_popped.includes(x)) continue; s += i; } return s; }
function texts_popped_second(list) { let s = ""; for (const x of list) s += (L_texts_popped.includes(x, 1) ? 1 : 0) + (L_texts_popped.includes(x, -1) ? 2 : 0) + (L_texts_popped.includes() ? 4 : 0) + (L_texts_popped?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_popped, x) ? 16 : 0); return s; }
function texts_popped_once(x) { return L_texts_popped.includes(x); }
function texts_popped_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_popped_change(); } catch (e) { s += e.name; } } s += L_texts_popped.includes(list[i]) ? 1 : 0; } return s; }
function texts_popped_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_popped.pop(); } catch (e) { s += e.name; } } s += L_texts_popped.includes(list[i]) ? 1 : 0; s += L_texts_popped.length; } return s; }
const L_texts_stored = ["g1", "g3", "g5"];
function texts_stored_change() { L_texts_stored[0] = "g2"; }
function texts_stored_of(list) { let s = ""; for (const x of list) s += L_texts_stored.includes(x) ? 1 : 0; return s; }
function texts_stored_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_stored.includes(list[i])) h += i; else h -= 1; return h; }
function texts_stored_filter(list) { return list.filter(x => L_texts_stored.includes(x)).length; }
function texts_stored_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_stored.includes(x)) continue; s += i; } return s; }
function texts_stored_second(list) { let s = ""; for (const x of list) s += (L_texts_stored.includes(x, 1) ? 1 : 0) + (L_texts_stored.includes(x, -1) ? 2 : 0) + (L_texts_stored.includes() ? 4 : 0) + (L_texts_stored?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_stored, x) ? 16 : 0); return s; }
function texts_stored_once(x) { return L_texts_stored.includes(x); }
function texts_stored_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_stored_change(); } catch (e) { s += e.name; } } s += L_texts_stored.includes(list[i]) ? 1 : 0; } return s; }
function texts_stored_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_stored[0] = "g2"; } catch (e) { s += e.name; } } s += L_texts_stored.includes(list[i]) ? 1 : 0; s += L_texts_stored.length; } return s; }
const L_texts_storedNumber = ["g1", "g3", "g5"];
function texts_storedNumber_change() { L_texts_storedNumber[1] = 5; }
function texts_storedNumber_of(list) { let s = ""; for (const x of list) s += L_texts_storedNumber.includes(x) ? 1 : 0; return s; }
function texts_storedNumber_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_storedNumber.includes(list[i])) h += i; else h -= 1; return h; }
function texts_storedNumber_filter(list) { return list.filter(x => L_texts_storedNumber.includes(x)).length; }
function texts_storedNumber_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_storedNumber.includes(x)) continue; s += i; } return s; }
function texts_storedNumber_second(list) { let s = ""; for (const x of list) s += (L_texts_storedNumber.includes(x, 1) ? 1 : 0) + (L_texts_storedNumber.includes(x, -1) ? 2 : 0) + (L_texts_storedNumber.includes() ? 4 : 0) + (L_texts_storedNumber?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_storedNumber, x) ? 16 : 0); return s; }
function texts_storedNumber_once(x) { return L_texts_storedNumber.includes(x); }
function texts_storedNumber_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_storedNumber_change(); } catch (e) { s += e.name; } } s += L_texts_storedNumber.includes(list[i]) ? 1 : 0; } return s; }
function texts_storedNumber_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_storedNumber[1] = 5; } catch (e) { s += e.name; } } s += L_texts_storedNumber.includes(list[i]) ? 1 : 0; s += L_texts_storedNumber.length; } return s; }
const L_texts_storedAfar = ["g1", "g3", "g5"];
function texts_storedAfar_change() { L_texts_storedAfar[L_texts_storedAfar.length + 2] = "a"; }
function texts_storedAfar_of(list) { let s = ""; for (const x of list) s += L_texts_storedAfar.includes(x) ? 1 : 0; return s; }
function texts_storedAfar_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_storedAfar.includes(list[i])) h += i; else h -= 1; return h; }
function texts_storedAfar_filter(list) { return list.filter(x => L_texts_storedAfar.includes(x)).length; }
function texts_storedAfar_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_storedAfar.includes(x)) continue; s += i; } return s; }
function texts_storedAfar_second(list) { let s = ""; for (const x of list) s += (L_texts_storedAfar.includes(x, 1) ? 1 : 0) + (L_texts_storedAfar.includes(x, -1) ? 2 : 0) + (L_texts_storedAfar.includes() ? 4 : 0) + (L_texts_storedAfar?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_storedAfar, x) ? 16 : 0); return s; }
function texts_storedAfar_once(x) { return L_texts_storedAfar.includes(x); }
function texts_storedAfar_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_storedAfar_change(); } catch (e) { s += e.name; } } s += L_texts_storedAfar.includes(list[i]) ? 1 : 0; } return s; }
function texts_storedAfar_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_storedAfar[L_texts_storedAfar.length + 2] = "a"; } catch (e) { s += e.name; } } s += L_texts_storedAfar.includes(list[i]) ? 1 : 0; s += L_texts_storedAfar.length; } return s; }
const L_texts_sorted = ["g1", "g3", "g5"];
function texts_sorted_change() { L_texts_sorted.sort(); }
function texts_sorted_of(list) { let s = ""; for (const x of list) s += L_texts_sorted.includes(x) ? 1 : 0; return s; }
function texts_sorted_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_sorted.includes(list[i])) h += i; else h -= 1; return h; }
function texts_sorted_filter(list) { return list.filter(x => L_texts_sorted.includes(x)).length; }
function texts_sorted_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_sorted.includes(x)) continue; s += i; } return s; }
function texts_sorted_second(list) { let s = ""; for (const x of list) s += (L_texts_sorted.includes(x, 1) ? 1 : 0) + (L_texts_sorted.includes(x, -1) ? 2 : 0) + (L_texts_sorted.includes() ? 4 : 0) + (L_texts_sorted?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_sorted, x) ? 16 : 0); return s; }
function texts_sorted_once(x) { return L_texts_sorted.includes(x); }
function texts_sorted_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_sorted_change(); } catch (e) { s += e.name; } } s += L_texts_sorted.includes(list[i]) ? 1 : 0; } return s; }
function texts_sorted_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_sorted.sort(); } catch (e) { s += e.name; } } s += L_texts_sorted.includes(list[i]) ? 1 : 0; s += L_texts_sorted.length; } return s; }
const L_texts_reversed = ["g1", "g3", "g5"];
function texts_reversed_change() { L_texts_reversed.reverse(); }
function texts_reversed_of(list) { let s = ""; for (const x of list) s += L_texts_reversed.includes(x) ? 1 : 0; return s; }
function texts_reversed_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_reversed.includes(list[i])) h += i; else h -= 1; return h; }
function texts_reversed_filter(list) { return list.filter(x => L_texts_reversed.includes(x)).length; }
function texts_reversed_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_reversed.includes(x)) continue; s += i; } return s; }
function texts_reversed_second(list) { let s = ""; for (const x of list) s += (L_texts_reversed.includes(x, 1) ? 1 : 0) + (L_texts_reversed.includes(x, -1) ? 2 : 0) + (L_texts_reversed.includes() ? 4 : 0) + (L_texts_reversed?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_reversed, x) ? 16 : 0); return s; }
function texts_reversed_once(x) { return L_texts_reversed.includes(x); }
function texts_reversed_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_reversed_change(); } catch (e) { s += e.name; } } s += L_texts_reversed.includes(list[i]) ? 1 : 0; } return s; }
function texts_reversed_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_reversed.reverse(); } catch (e) { s += e.name; } } s += L_texts_reversed.includes(list[i]) ? 1 : 0; s += L_texts_reversed.length; } return s; }
const L_texts_shortened = ["g1", "g3", "g5"];
function texts_shortened_change() { L_texts_shortened.length = Math.min(1, L_texts_shortened.length); }
function texts_shortened_of(list) { let s = ""; for (const x of list) s += L_texts_shortened.includes(x) ? 1 : 0; return s; }
function texts_shortened_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_shortened.includes(list[i])) h += i; else h -= 1; return h; }
function texts_shortened_filter(list) { return list.filter(x => L_texts_shortened.includes(x)).length; }
function texts_shortened_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_shortened.includes(x)) continue; s += i; } return s; }
function texts_shortened_second(list) { let s = ""; for (const x of list) s += (L_texts_shortened.includes(x, 1) ? 1 : 0) + (L_texts_shortened.includes(x, -1) ? 2 : 0) + (L_texts_shortened.includes() ? 4 : 0) + (L_texts_shortened?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_shortened, x) ? 16 : 0); return s; }
function texts_shortened_once(x) { return L_texts_shortened.includes(x); }
function texts_shortened_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_shortened_change(); } catch (e) { s += e.name; } } s += L_texts_shortened.includes(list[i]) ? 1 : 0; } return s; }
function texts_shortened_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_shortened.length = Math.min(1, L_texts_shortened.length); } catch (e) { s += e.name; } } s += L_texts_shortened.includes(list[i]) ? 1 : 0; s += L_texts_shortened.length; } return s; }
const L_texts_emptied = ["g1", "g3", "g5"];
function texts_emptied_change() { L_texts_emptied.length = 0; }
function texts_emptied_of(list) { let s = ""; for (const x of list) s += L_texts_emptied.includes(x) ? 1 : 0; return s; }
function texts_emptied_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_emptied.includes(list[i])) h += i; else h -= 1; return h; }
function texts_emptied_filter(list) { return list.filter(x => L_texts_emptied.includes(x)).length; }
function texts_emptied_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_emptied.includes(x)) continue; s += i; } return s; }
function texts_emptied_second(list) { let s = ""; for (const x of list) s += (L_texts_emptied.includes(x, 1) ? 1 : 0) + (L_texts_emptied.includes(x, -1) ? 2 : 0) + (L_texts_emptied.includes() ? 4 : 0) + (L_texts_emptied?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_emptied, x) ? 16 : 0); return s; }
function texts_emptied_once(x) { return L_texts_emptied.includes(x); }
function texts_emptied_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_emptied_change(); } catch (e) { s += e.name; } } s += L_texts_emptied.includes(list[i]) ? 1 : 0; } return s; }
function texts_emptied_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_emptied.length = 0; } catch (e) { s += e.name; } } s += L_texts_emptied.includes(list[i]) ? 1 : 0; s += L_texts_emptied.length; } return s; }
const L_texts_spliced = ["g1", "g3", "g5"];
function texts_spliced_change() { L_texts_spliced.splice(0, 1, "ab"); }
function texts_spliced_of(list) { let s = ""; for (const x of list) s += L_texts_spliced.includes(x) ? 1 : 0; return s; }
function texts_spliced_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_spliced.includes(list[i])) h += i; else h -= 1; return h; }
function texts_spliced_filter(list) { return list.filter(x => L_texts_spliced.includes(x)).length; }
function texts_spliced_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_spliced.includes(x)) continue; s += i; } return s; }
function texts_spliced_second(list) { let s = ""; for (const x of list) s += (L_texts_spliced.includes(x, 1) ? 1 : 0) + (L_texts_spliced.includes(x, -1) ? 2 : 0) + (L_texts_spliced.includes() ? 4 : 0) + (L_texts_spliced?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_spliced, x) ? 16 : 0); return s; }
function texts_spliced_once(x) { return L_texts_spliced.includes(x); }
function texts_spliced_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_spliced_change(); } catch (e) { s += e.name; } } s += L_texts_spliced.includes(list[i]) ? 1 : 0; } return s; }
function texts_spliced_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_spliced.splice(0, 1, "ab"); } catch (e) { s += e.name; } } s += L_texts_spliced.includes(list[i]) ? 1 : 0; s += L_texts_spliced.length; } return s; }
const L_texts_shifted = ["g1", "g3", "g5"];
function texts_shifted_change() { L_texts_shifted.shift(); }
function texts_shifted_of(list) { let s = ""; for (const x of list) s += L_texts_shifted.includes(x) ? 1 : 0; return s; }
function texts_shifted_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_shifted.includes(list[i])) h += i; else h -= 1; return h; }
function texts_shifted_filter(list) { return list.filter(x => L_texts_shifted.includes(x)).length; }
function texts_shifted_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_shifted.includes(x)) continue; s += i; } return s; }
function texts_shifted_second(list) { let s = ""; for (const x of list) s += (L_texts_shifted.includes(x, 1) ? 1 : 0) + (L_texts_shifted.includes(x, -1) ? 2 : 0) + (L_texts_shifted.includes() ? 4 : 0) + (L_texts_shifted?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_shifted, x) ? 16 : 0); return s; }
function texts_shifted_once(x) { return L_texts_shifted.includes(x); }
function texts_shifted_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_shifted_change(); } catch (e) { s += e.name; } } s += L_texts_shifted.includes(list[i]) ? 1 : 0; } return s; }
function texts_shifted_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_shifted.shift(); } catch (e) { s += e.name; } } s += L_texts_shifted.includes(list[i]) ? 1 : 0; s += L_texts_shifted.length; } return s; }
const L_texts_unshifted = ["g1", "g3", "g5"];
function texts_unshifted_change() { L_texts_unshifted.unshift("日本"); }
function texts_unshifted_of(list) { let s = ""; for (const x of list) s += L_texts_unshifted.includes(x) ? 1 : 0; return s; }
function texts_unshifted_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_unshifted.includes(list[i])) h += i; else h -= 1; return h; }
function texts_unshifted_filter(list) { return list.filter(x => L_texts_unshifted.includes(x)).length; }
function texts_unshifted_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_unshifted.includes(x)) continue; s += i; } return s; }
function texts_unshifted_second(list) { let s = ""; for (const x of list) s += (L_texts_unshifted.includes(x, 1) ? 1 : 0) + (L_texts_unshifted.includes(x, -1) ? 2 : 0) + (L_texts_unshifted.includes() ? 4 : 0) + (L_texts_unshifted?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_unshifted, x) ? 16 : 0); return s; }
function texts_unshifted_once(x) { return L_texts_unshifted.includes(x); }
function texts_unshifted_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_unshifted_change(); } catch (e) { s += e.name; } } s += L_texts_unshifted.includes(list[i]) ? 1 : 0; } return s; }
function texts_unshifted_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_unshifted.unshift("日本"); } catch (e) { s += e.name; } } s += L_texts_unshifted.includes(list[i]) ? 1 : 0; s += L_texts_unshifted.length; } return s; }
const L_texts_filled = ["g1", "g3", "g5"];
function texts_filled_change() { L_texts_filled.fill("ab"); }
function texts_filled_of(list) { let s = ""; for (const x of list) s += L_texts_filled.includes(x) ? 1 : 0; return s; }
function texts_filled_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_filled.includes(list[i])) h += i; else h -= 1; return h; }
function texts_filled_filter(list) { return list.filter(x => L_texts_filled.includes(x)).length; }
function texts_filled_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_filled.includes(x)) continue; s += i; } return s; }
function texts_filled_second(list) { let s = ""; for (const x of list) s += (L_texts_filled.includes(x, 1) ? 1 : 0) + (L_texts_filled.includes(x, -1) ? 2 : 0) + (L_texts_filled.includes() ? 4 : 0) + (L_texts_filled?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_filled, x) ? 16 : 0); return s; }
function texts_filled_once(x) { return L_texts_filled.includes(x); }
function texts_filled_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_filled_change(); } catch (e) { s += e.name; } } s += L_texts_filled.includes(list[i]) ? 1 : 0; } return s; }
function texts_filled_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_filled.fill("ab"); } catch (e) { s += e.name; } } s += L_texts_filled.includes(list[i]) ? 1 : 0; s += L_texts_filled.length; } return s; }
const L_texts_deleted = ["g1", "g3", "g5"];
function texts_deleted_change() { delete L_texts_deleted[0]; }
function texts_deleted_of(list) { let s = ""; for (const x of list) s += L_texts_deleted.includes(x) ? 1 : 0; return s; }
function texts_deleted_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_deleted.includes(list[i])) h += i; else h -= 1; return h; }
function texts_deleted_filter(list) { return list.filter(x => L_texts_deleted.includes(x)).length; }
function texts_deleted_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_deleted.includes(x)) continue; s += i; } return s; }
function texts_deleted_second(list) { let s = ""; for (const x of list) s += (L_texts_deleted.includes(x, 1) ? 1 : 0) + (L_texts_deleted.includes(x, -1) ? 2 : 0) + (L_texts_deleted.includes() ? 4 : 0) + (L_texts_deleted?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_deleted, x) ? 16 : 0); return s; }
function texts_deleted_once(x) { return L_texts_deleted.includes(x); }
function texts_deleted_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_deleted_change(); } catch (e) { s += e.name; } } s += L_texts_deleted.includes(list[i]) ? 1 : 0; } return s; }
function texts_deleted_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { delete L_texts_deleted[0]; } catch (e) { s += e.name; } } s += L_texts_deleted.includes(list[i]) ? 1 : 0; s += L_texts_deleted.length; } return s; }
const L_texts_frozen = ["g1", "g3", "g5"];
function texts_frozen_change() { Object.freeze(L_texts_frozen); }
function texts_frozen_of(list) { let s = ""; for (const x of list) s += L_texts_frozen.includes(x) ? 1 : 0; return s; }
function texts_frozen_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_frozen.includes(list[i])) h += i; else h -= 1; return h; }
function texts_frozen_filter(list) { return list.filter(x => L_texts_frozen.includes(x)).length; }
function texts_frozen_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_frozen.includes(x)) continue; s += i; } return s; }
function texts_frozen_second(list) { let s = ""; for (const x of list) s += (L_texts_frozen.includes(x, 1) ? 1 : 0) + (L_texts_frozen.includes(x, -1) ? 2 : 0) + (L_texts_frozen.includes() ? 4 : 0) + (L_texts_frozen?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_frozen, x) ? 16 : 0); return s; }
function texts_frozen_once(x) { return L_texts_frozen.includes(x); }
function texts_frozen_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_frozen_change(); } catch (e) { s += e.name; } } s += L_texts_frozen.includes(list[i]) ? 1 : 0; } return s; }
function texts_frozen_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { Object.freeze(L_texts_frozen); } catch (e) { s += e.name; } } s += L_texts_frozen.includes(list[i]) ? 1 : 0; s += L_texts_frozen.length; } return s; }
const L_texts_aliased = ["g1", "g3", "g5"];
function texts_aliased_change() { (alias => { alias[0] = "é"; })(L_texts_aliased); }
function texts_aliased_of(list) { let s = ""; for (const x of list) s += L_texts_aliased.includes(x) ? 1 : 0; return s; }
function texts_aliased_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_aliased.includes(list[i])) h += i; else h -= 1; return h; }
function texts_aliased_filter(list) { return list.filter(x => L_texts_aliased.includes(x)).length; }
function texts_aliased_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_aliased.includes(x)) continue; s += i; } return s; }
function texts_aliased_second(list) { let s = ""; for (const x of list) s += (L_texts_aliased.includes(x, 1) ? 1 : 0) + (L_texts_aliased.includes(x, -1) ? 2 : 0) + (L_texts_aliased.includes() ? 4 : 0) + (L_texts_aliased?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_aliased, x) ? 16 : 0); return s; }
function texts_aliased_once(x) { return L_texts_aliased.includes(x); }
function texts_aliased_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_aliased_change(); } catch (e) { s += e.name; } } s += L_texts_aliased.includes(list[i]) ? 1 : 0; } return s; }
function texts_aliased_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { (alias => { alias[0] = "é"; })(L_texts_aliased); } catch (e) { s += e.name; } } s += L_texts_aliased.includes(list[i]) ? 1 : 0; s += L_texts_aliased.length; } return s; }
const L_texts_own = ["g1", "g3", "g5"];
function texts_own_change() { L_texts_own.includes = x => x === "a"; }
function texts_own_of(list) { let s = ""; for (const x of list) s += L_texts_own.includes(x) ? 1 : 0; return s; }
function texts_own_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_texts_own.includes(list[i])) h += i; else h -= 1; return h; }
function texts_own_filter(list) { return list.filter(x => L_texts_own.includes(x)).length; }
function texts_own_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_texts_own.includes(x)) continue; s += i; } return s; }
function texts_own_second(list) { let s = ""; for (const x of list) s += (L_texts_own.includes(x, 1) ? 1 : 0) + (L_texts_own.includes(x, -1) ? 2 : 0) + (L_texts_own.includes() ? 4 : 0) + (L_texts_own?.includes(x) ? 8 : 0) + ([].includes.call(L_texts_own, x) ? 16 : 0); return s; }
function texts_own_once(x) { return L_texts_own.includes(x); }
function texts_own_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { texts_own_change(); } catch (e) { s += e.name; } } s += L_texts_own.includes(list[i]) ? 1 : 0; } return s; }
function texts_own_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_texts_own.includes = x => x === "a"; } catch (e) { s += e.name; } } s += L_texts_own.includes(list[i]) ? 1 : 0; s += L_texts_own.length; } return s; }
const L_nine_kept = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"];
function nine_kept_change() { ; }
function nine_kept_of(list) { let s = ""; for (const x of list) s += L_nine_kept.includes(x) ? 1 : 0; return s; }
function nine_kept_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_nine_kept.includes(list[i])) h += i; else h -= 1; return h; }
function nine_kept_filter(list) { return list.filter(x => L_nine_kept.includes(x)).length; }
function nine_kept_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_nine_kept.includes(x)) continue; s += i; } return s; }
function nine_kept_second(list) { let s = ""; for (const x of list) s += (L_nine_kept.includes(x, 1) ? 1 : 0) + (L_nine_kept.includes(x, -1) ? 2 : 0) + (L_nine_kept.includes() ? 4 : 0) + (L_nine_kept?.includes(x) ? 8 : 0) + ([].includes.call(L_nine_kept, x) ? 16 : 0); return s; }
function nine_kept_once(x) { return L_nine_kept.includes(x); }
function nine_kept_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { nine_kept_change(); } catch (e) { s += e.name; } } s += L_nine_kept.includes(list[i]) ? 1 : 0; } return s; }
function nine_kept_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { ; } catch (e) { s += e.name; } } s += L_nine_kept.includes(list[i]) ? 1 : 0; s += L_nine_kept.length; } return s; }
const L_nine_pushed = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"];
function nine_pushed_change() { L_nine_pushed.push("g9", 2); }
function nine_pushed_of(list) { let s = ""; for (const x of list) s += L_nine_pushed.includes(x) ? 1 : 0; return s; }
function nine_pushed_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_nine_pushed.includes(list[i])) h += i; else h -= 1; return h; }
function nine_pushed_filter(list) { return list.filter(x => L_nine_pushed.includes(x)).length; }
function nine_pushed_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_nine_pushed.includes(x)) continue; s += i; } return s; }
function nine_pushed_second(list) { let s = ""; for (const x of list) s += (L_nine_pushed.includes(x, 1) ? 1 : 0) + (L_nine_pushed.includes(x, -1) ? 2 : 0) + (L_nine_pushed.includes() ? 4 : 0) + (L_nine_pushed?.includes(x) ? 8 : 0) + ([].includes.call(L_nine_pushed, x) ? 16 : 0); return s; }
function nine_pushed_once(x) { return L_nine_pushed.includes(x); }
function nine_pushed_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { nine_pushed_change(); } catch (e) { s += e.name; } } s += L_nine_pushed.includes(list[i]) ? 1 : 0; } return s; }
function nine_pushed_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_nine_pushed.push("g9", 2); } catch (e) { s += e.name; } } s += L_nine_pushed.includes(list[i]) ? 1 : 0; s += L_nine_pushed.length; } return s; }
const L_nine_stored = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"];
function nine_stored_change() { L_nine_stored[0] = "g2"; }
function nine_stored_of(list) { let s = ""; for (const x of list) s += L_nine_stored.includes(x) ? 1 : 0; return s; }
function nine_stored_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_nine_stored.includes(list[i])) h += i; else h -= 1; return h; }
function nine_stored_filter(list) { return list.filter(x => L_nine_stored.includes(x)).length; }
function nine_stored_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_nine_stored.includes(x)) continue; s += i; } return s; }
function nine_stored_second(list) { let s = ""; for (const x of list) s += (L_nine_stored.includes(x, 1) ? 1 : 0) + (L_nine_stored.includes(x, -1) ? 2 : 0) + (L_nine_stored.includes() ? 4 : 0) + (L_nine_stored?.includes(x) ? 8 : 0) + ([].includes.call(L_nine_stored, x) ? 16 : 0); return s; }
function nine_stored_once(x) { return L_nine_stored.includes(x); }
function nine_stored_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { nine_stored_change(); } catch (e) { s += e.name; } } s += L_nine_stored.includes(list[i]) ? 1 : 0; } return s; }
function nine_stored_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_nine_stored[0] = "g2"; } catch (e) { s += e.name; } } s += L_nine_stored.includes(list[i]) ? 1 : 0; s += L_nine_stored.length; } return s; }
const L_nine_storedNumber = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"];
function nine_storedNumber_change() { L_nine_storedNumber[1] = 5; }
function nine_storedNumber_of(list) { let s = ""; for (const x of list) s += L_nine_storedNumber.includes(x) ? 1 : 0; return s; }
function nine_storedNumber_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_nine_storedNumber.includes(list[i])) h += i; else h -= 1; return h; }
function nine_storedNumber_filter(list) { return list.filter(x => L_nine_storedNumber.includes(x)).length; }
function nine_storedNumber_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_nine_storedNumber.includes(x)) continue; s += i; } return s; }
function nine_storedNumber_second(list) { let s = ""; for (const x of list) s += (L_nine_storedNumber.includes(x, 1) ? 1 : 0) + (L_nine_storedNumber.includes(x, -1) ? 2 : 0) + (L_nine_storedNumber.includes() ? 4 : 0) + (L_nine_storedNumber?.includes(x) ? 8 : 0) + ([].includes.call(L_nine_storedNumber, x) ? 16 : 0); return s; }
function nine_storedNumber_once(x) { return L_nine_storedNumber.includes(x); }
function nine_storedNumber_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { nine_storedNumber_change(); } catch (e) { s += e.name; } } s += L_nine_storedNumber.includes(list[i]) ? 1 : 0; } return s; }
function nine_storedNumber_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_nine_storedNumber[1] = 5; } catch (e) { s += e.name; } } s += L_nine_storedNumber.includes(list[i]) ? 1 : 0; s += L_nine_storedNumber.length; } return s; }
const L_nine_sorted = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"];
function nine_sorted_change() { L_nine_sorted.sort(); }
function nine_sorted_of(list) { let s = ""; for (const x of list) s += L_nine_sorted.includes(x) ? 1 : 0; return s; }
function nine_sorted_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_nine_sorted.includes(list[i])) h += i; else h -= 1; return h; }
function nine_sorted_filter(list) { return list.filter(x => L_nine_sorted.includes(x)).length; }
function nine_sorted_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_nine_sorted.includes(x)) continue; s += i; } return s; }
function nine_sorted_second(list) { let s = ""; for (const x of list) s += (L_nine_sorted.includes(x, 1) ? 1 : 0) + (L_nine_sorted.includes(x, -1) ? 2 : 0) + (L_nine_sorted.includes() ? 4 : 0) + (L_nine_sorted?.includes(x) ? 8 : 0) + ([].includes.call(L_nine_sorted, x) ? 16 : 0); return s; }
function nine_sorted_once(x) { return L_nine_sorted.includes(x); }
function nine_sorted_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { nine_sorted_change(); } catch (e) { s += e.name; } } s += L_nine_sorted.includes(list[i]) ? 1 : 0; } return s; }
function nine_sorted_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_nine_sorted.sort(); } catch (e) { s += e.name; } } s += L_nine_sorted.includes(list[i]) ? 1 : 0; s += L_nine_sorted.length; } return s; }
const L_nine_shortened = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"];
function nine_shortened_change() { L_nine_shortened.length = Math.min(1, L_nine_shortened.length); }
function nine_shortened_of(list) { let s = ""; for (const x of list) s += L_nine_shortened.includes(x) ? 1 : 0; return s; }
function nine_shortened_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_nine_shortened.includes(list[i])) h += i; else h -= 1; return h; }
function nine_shortened_filter(list) { return list.filter(x => L_nine_shortened.includes(x)).length; }
function nine_shortened_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_nine_shortened.includes(x)) continue; s += i; } return s; }
function nine_shortened_second(list) { let s = ""; for (const x of list) s += (L_nine_shortened.includes(x, 1) ? 1 : 0) + (L_nine_shortened.includes(x, -1) ? 2 : 0) + (L_nine_shortened.includes() ? 4 : 0) + (L_nine_shortened?.includes(x) ? 8 : 0) + ([].includes.call(L_nine_shortened, x) ? 16 : 0); return s; }
function nine_shortened_once(x) { return L_nine_shortened.includes(x); }
function nine_shortened_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { nine_shortened_change(); } catch (e) { s += e.name; } } s += L_nine_shortened.includes(list[i]) ? 1 : 0; } return s; }
function nine_shortened_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_nine_shortened.length = Math.min(1, L_nine_shortened.length); } catch (e) { s += e.name; } } s += L_nine_shortened.includes(list[i]) ? 1 : 0; s += L_nine_shortened.length; } return s; }
const L_nine_spliced = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"];
function nine_spliced_change() { L_nine_spliced.splice(0, 1, "ab"); }
function nine_spliced_of(list) { let s = ""; for (const x of list) s += L_nine_spliced.includes(x) ? 1 : 0; return s; }
function nine_spliced_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_nine_spliced.includes(list[i])) h += i; else h -= 1; return h; }
function nine_spliced_filter(list) { return list.filter(x => L_nine_spliced.includes(x)).length; }
function nine_spliced_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_nine_spliced.includes(x)) continue; s += i; } return s; }
function nine_spliced_second(list) { let s = ""; for (const x of list) s += (L_nine_spliced.includes(x, 1) ? 1 : 0) + (L_nine_spliced.includes(x, -1) ? 2 : 0) + (L_nine_spliced.includes() ? 4 : 0) + (L_nine_spliced?.includes(x) ? 8 : 0) + ([].includes.call(L_nine_spliced, x) ? 16 : 0); return s; }
function nine_spliced_once(x) { return L_nine_spliced.includes(x); }
function nine_spliced_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { nine_spliced_change(); } catch (e) { s += e.name; } } s += L_nine_spliced.includes(list[i]) ? 1 : 0; } return s; }
function nine_spliced_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_nine_spliced.splice(0, 1, "ab"); } catch (e) { s += e.name; } } s += L_nine_spliced.includes(list[i]) ? 1 : 0; s += L_nine_spliced.length; } return s; }
const L_nine_deleted = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"];
function nine_deleted_change() { delete L_nine_deleted[0]; }
function nine_deleted_of(list) { let s = ""; for (const x of list) s += L_nine_deleted.includes(x) ? 1 : 0; return s; }
function nine_deleted_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_nine_deleted.includes(list[i])) h += i; else h -= 1; return h; }
function nine_deleted_filter(list) { return list.filter(x => L_nine_deleted.includes(x)).length; }
function nine_deleted_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_nine_deleted.includes(x)) continue; s += i; } return s; }
function nine_deleted_second(list) { let s = ""; for (const x of list) s += (L_nine_deleted.includes(x, 1) ? 1 : 0) + (L_nine_deleted.includes(x, -1) ? 2 : 0) + (L_nine_deleted.includes() ? 4 : 0) + (L_nine_deleted?.includes(x) ? 8 : 0) + ([].includes.call(L_nine_deleted, x) ? 16 : 0); return s; }
function nine_deleted_once(x) { return L_nine_deleted.includes(x); }
function nine_deleted_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { nine_deleted_change(); } catch (e) { s += e.name; } } s += L_nine_deleted.includes(list[i]) ? 1 : 0; } return s; }
function nine_deleted_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { delete L_nine_deleted[0]; } catch (e) { s += e.name; } } s += L_nine_deleted.includes(list[i]) ? 1 : 0; s += L_nine_deleted.length; } return s; }
const L_nine_frozen = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"];
function nine_frozen_change() { Object.freeze(L_nine_frozen); }
function nine_frozen_of(list) { let s = ""; for (const x of list) s += L_nine_frozen.includes(x) ? 1 : 0; return s; }
function nine_frozen_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_nine_frozen.includes(list[i])) h += i; else h -= 1; return h; }
function nine_frozen_filter(list) { return list.filter(x => L_nine_frozen.includes(x)).length; }
function nine_frozen_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_nine_frozen.includes(x)) continue; s += i; } return s; }
function nine_frozen_second(list) { let s = ""; for (const x of list) s += (L_nine_frozen.includes(x, 1) ? 1 : 0) + (L_nine_frozen.includes(x, -1) ? 2 : 0) + (L_nine_frozen.includes() ? 4 : 0) + (L_nine_frozen?.includes(x) ? 8 : 0) + ([].includes.call(L_nine_frozen, x) ? 16 : 0); return s; }
function nine_frozen_once(x) { return L_nine_frozen.includes(x); }
function nine_frozen_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { nine_frozen_change(); } catch (e) { s += e.name; } } s += L_nine_frozen.includes(list[i]) ? 1 : 0; } return s; }
function nine_frozen_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { Object.freeze(L_nine_frozen); } catch (e) { s += e.name; } } s += L_nine_frozen.includes(list[i]) ? 1 : 0; s += L_nine_frozen.length; } return s; }
const L_nine_aliased = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"];
function nine_aliased_change() { (alias => { alias[0] = "é"; })(L_nine_aliased); }
function nine_aliased_of(list) { let s = ""; for (const x of list) s += L_nine_aliased.includes(x) ? 1 : 0; return s; }
function nine_aliased_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_nine_aliased.includes(list[i])) h += i; else h -= 1; return h; }
function nine_aliased_filter(list) { return list.filter(x => L_nine_aliased.includes(x)).length; }
function nine_aliased_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_nine_aliased.includes(x)) continue; s += i; } return s; }
function nine_aliased_second(list) { let s = ""; for (const x of list) s += (L_nine_aliased.includes(x, 1) ? 1 : 0) + (L_nine_aliased.includes(x, -1) ? 2 : 0) + (L_nine_aliased.includes() ? 4 : 0) + (L_nine_aliased?.includes(x) ? 8 : 0) + ([].includes.call(L_nine_aliased, x) ? 16 : 0); return s; }
function nine_aliased_once(x) { return L_nine_aliased.includes(x); }
function nine_aliased_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { nine_aliased_change(); } catch (e) { s += e.name; } } s += L_nine_aliased.includes(list[i]) ? 1 : 0; } return s; }
function nine_aliased_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { (alias => { alias[0] = "é"; })(L_nine_aliased); } catch (e) { s += e.name; } } s += L_nine_aliased.includes(list[i]) ? 1 : 0; s += L_nine_aliased.length; } return s; }
const L_nine_own = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"];
function nine_own_change() { L_nine_own.includes = x => x === "a"; }
function nine_own_of(list) { let s = ""; for (const x of list) s += L_nine_own.includes(x) ? 1 : 0; return s; }
function nine_own_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_nine_own.includes(list[i])) h += i; else h -= 1; return h; }
function nine_own_filter(list) { return list.filter(x => L_nine_own.includes(x)).length; }
function nine_own_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_nine_own.includes(x)) continue; s += i; } return s; }
function nine_own_second(list) { let s = ""; for (const x of list) s += (L_nine_own.includes(x, 1) ? 1 : 0) + (L_nine_own.includes(x, -1) ? 2 : 0) + (L_nine_own.includes() ? 4 : 0) + (L_nine_own?.includes(x) ? 8 : 0) + ([].includes.call(L_nine_own, x) ? 16 : 0); return s; }
function nine_own_once(x) { return L_nine_own.includes(x); }
function nine_own_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { nine_own_change(); } catch (e) { s += e.name; } } s += L_nine_own.includes(list[i]) ? 1 : 0; } return s; }
function nine_own_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_nine_own.includes = x => x === "a"; } catch (e) { s += e.name; } } s += L_nine_own.includes(list[i]) ? 1 : 0; s += L_nine_own.length; } return s; }
const L_zeros_kept = [0, -1];
function zeros_kept_change() { ; }
function zeros_kept_of(list) { let s = ""; for (const x of list) s += L_zeros_kept.includes(x) ? 1 : 0; return s; }
function zeros_kept_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_zeros_kept.includes(list[i])) h += i; else h -= 1; return h; }
function zeros_kept_filter(list) { return list.filter(x => L_zeros_kept.includes(x)).length; }
function zeros_kept_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_zeros_kept.includes(x)) continue; s += i; } return s; }
function zeros_kept_second(list) { let s = ""; for (const x of list) s += (L_zeros_kept.includes(x, 1) ? 1 : 0) + (L_zeros_kept.includes(x, -1) ? 2 : 0) + (L_zeros_kept.includes() ? 4 : 0) + (L_zeros_kept?.includes(x) ? 8 : 0) + ([].includes.call(L_zeros_kept, x) ? 16 : 0); return s; }
function zeros_kept_once(x) { return L_zeros_kept.includes(x); }
function zeros_kept_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { zeros_kept_change(); } catch (e) { s += e.name; } } s += L_zeros_kept.includes(list[i]) ? 1 : 0; } return s; }
function zeros_kept_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { ; } catch (e) { s += e.name; } } s += L_zeros_kept.includes(list[i]) ? 1 : 0; s += L_zeros_kept.length; } return s; }
const L_zeros_pushed = [0, -1];
function zeros_pushed_change() { L_zeros_pushed.push("g9", 2); }
function zeros_pushed_of(list) { let s = ""; for (const x of list) s += L_zeros_pushed.includes(x) ? 1 : 0; return s; }
function zeros_pushed_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_zeros_pushed.includes(list[i])) h += i; else h -= 1; return h; }
function zeros_pushed_filter(list) { return list.filter(x => L_zeros_pushed.includes(x)).length; }
function zeros_pushed_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_zeros_pushed.includes(x)) continue; s += i; } return s; }
function zeros_pushed_second(list) { let s = ""; for (const x of list) s += (L_zeros_pushed.includes(x, 1) ? 1 : 0) + (L_zeros_pushed.includes(x, -1) ? 2 : 0) + (L_zeros_pushed.includes() ? 4 : 0) + (L_zeros_pushed?.includes(x) ? 8 : 0) + ([].includes.call(L_zeros_pushed, x) ? 16 : 0); return s; }
function zeros_pushed_once(x) { return L_zeros_pushed.includes(x); }
function zeros_pushed_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { zeros_pushed_change(); } catch (e) { s += e.name; } } s += L_zeros_pushed.includes(list[i]) ? 1 : 0; } return s; }
function zeros_pushed_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_zeros_pushed.push("g9", 2); } catch (e) { s += e.name; } } s += L_zeros_pushed.includes(list[i]) ? 1 : 0; s += L_zeros_pushed.length; } return s; }
const L_zeros_stored = [0, -1];
function zeros_stored_change() { L_zeros_stored[0] = "g2"; }
function zeros_stored_of(list) { let s = ""; for (const x of list) s += L_zeros_stored.includes(x) ? 1 : 0; return s; }
function zeros_stored_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_zeros_stored.includes(list[i])) h += i; else h -= 1; return h; }
function zeros_stored_filter(list) { return list.filter(x => L_zeros_stored.includes(x)).length; }
function zeros_stored_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_zeros_stored.includes(x)) continue; s += i; } return s; }
function zeros_stored_second(list) { let s = ""; for (const x of list) s += (L_zeros_stored.includes(x, 1) ? 1 : 0) + (L_zeros_stored.includes(x, -1) ? 2 : 0) + (L_zeros_stored.includes() ? 4 : 0) + (L_zeros_stored?.includes(x) ? 8 : 0) + ([].includes.call(L_zeros_stored, x) ? 16 : 0); return s; }
function zeros_stored_once(x) { return L_zeros_stored.includes(x); }
function zeros_stored_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { zeros_stored_change(); } catch (e) { s += e.name; } } s += L_zeros_stored.includes(list[i]) ? 1 : 0; } return s; }
function zeros_stored_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_zeros_stored[0] = "g2"; } catch (e) { s += e.name; } } s += L_zeros_stored.includes(list[i]) ? 1 : 0; s += L_zeros_stored.length; } return s; }
const L_zeros_storedNumber = [0, -1];
function zeros_storedNumber_change() { L_zeros_storedNumber[1] = 5; }
function zeros_storedNumber_of(list) { let s = ""; for (const x of list) s += L_zeros_storedNumber.includes(x) ? 1 : 0; return s; }
function zeros_storedNumber_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_zeros_storedNumber.includes(list[i])) h += i; else h -= 1; return h; }
function zeros_storedNumber_filter(list) { return list.filter(x => L_zeros_storedNumber.includes(x)).length; }
function zeros_storedNumber_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_zeros_storedNumber.includes(x)) continue; s += i; } return s; }
function zeros_storedNumber_second(list) { let s = ""; for (const x of list) s += (L_zeros_storedNumber.includes(x, 1) ? 1 : 0) + (L_zeros_storedNumber.includes(x, -1) ? 2 : 0) + (L_zeros_storedNumber.includes() ? 4 : 0) + (L_zeros_storedNumber?.includes(x) ? 8 : 0) + ([].includes.call(L_zeros_storedNumber, x) ? 16 : 0); return s; }
function zeros_storedNumber_once(x) { return L_zeros_storedNumber.includes(x); }
function zeros_storedNumber_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { zeros_storedNumber_change(); } catch (e) { s += e.name; } } s += L_zeros_storedNumber.includes(list[i]) ? 1 : 0; } return s; }
function zeros_storedNumber_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_zeros_storedNumber[1] = 5; } catch (e) { s += e.name; } } s += L_zeros_storedNumber.includes(list[i]) ? 1 : 0; s += L_zeros_storedNumber.length; } return s; }
const L_zeros_sorted = [0, -1];
function zeros_sorted_change() { L_zeros_sorted.sort(); }
function zeros_sorted_of(list) { let s = ""; for (const x of list) s += L_zeros_sorted.includes(x) ? 1 : 0; return s; }
function zeros_sorted_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_zeros_sorted.includes(list[i])) h += i; else h -= 1; return h; }
function zeros_sorted_filter(list) { return list.filter(x => L_zeros_sorted.includes(x)).length; }
function zeros_sorted_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_zeros_sorted.includes(x)) continue; s += i; } return s; }
function zeros_sorted_second(list) { let s = ""; for (const x of list) s += (L_zeros_sorted.includes(x, 1) ? 1 : 0) + (L_zeros_sorted.includes(x, -1) ? 2 : 0) + (L_zeros_sorted.includes() ? 4 : 0) + (L_zeros_sorted?.includes(x) ? 8 : 0) + ([].includes.call(L_zeros_sorted, x) ? 16 : 0); return s; }
function zeros_sorted_once(x) { return L_zeros_sorted.includes(x); }
function zeros_sorted_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { zeros_sorted_change(); } catch (e) { s += e.name; } } s += L_zeros_sorted.includes(list[i]) ? 1 : 0; } return s; }
function zeros_sorted_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_zeros_sorted.sort(); } catch (e) { s += e.name; } } s += L_zeros_sorted.includes(list[i]) ? 1 : 0; s += L_zeros_sorted.length; } return s; }
const L_zeros_shortened = [0, -1];
function zeros_shortened_change() { L_zeros_shortened.length = Math.min(1, L_zeros_shortened.length); }
function zeros_shortened_of(list) { let s = ""; for (const x of list) s += L_zeros_shortened.includes(x) ? 1 : 0; return s; }
function zeros_shortened_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_zeros_shortened.includes(list[i])) h += i; else h -= 1; return h; }
function zeros_shortened_filter(list) { return list.filter(x => L_zeros_shortened.includes(x)).length; }
function zeros_shortened_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_zeros_shortened.includes(x)) continue; s += i; } return s; }
function zeros_shortened_second(list) { let s = ""; for (const x of list) s += (L_zeros_shortened.includes(x, 1) ? 1 : 0) + (L_zeros_shortened.includes(x, -1) ? 2 : 0) + (L_zeros_shortened.includes() ? 4 : 0) + (L_zeros_shortened?.includes(x) ? 8 : 0) + ([].includes.call(L_zeros_shortened, x) ? 16 : 0); return s; }
function zeros_shortened_once(x) { return L_zeros_shortened.includes(x); }
function zeros_shortened_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { zeros_shortened_change(); } catch (e) { s += e.name; } } s += L_zeros_shortened.includes(list[i]) ? 1 : 0; } return s; }
function zeros_shortened_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_zeros_shortened.length = Math.min(1, L_zeros_shortened.length); } catch (e) { s += e.name; } } s += L_zeros_shortened.includes(list[i]) ? 1 : 0; s += L_zeros_shortened.length; } return s; }
const L_zeros_spliced = [0, -1];
function zeros_spliced_change() { L_zeros_spliced.splice(0, 1, "ab"); }
function zeros_spliced_of(list) { let s = ""; for (const x of list) s += L_zeros_spliced.includes(x) ? 1 : 0; return s; }
function zeros_spliced_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_zeros_spliced.includes(list[i])) h += i; else h -= 1; return h; }
function zeros_spliced_filter(list) { return list.filter(x => L_zeros_spliced.includes(x)).length; }
function zeros_spliced_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_zeros_spliced.includes(x)) continue; s += i; } return s; }
function zeros_spliced_second(list) { let s = ""; for (const x of list) s += (L_zeros_spliced.includes(x, 1) ? 1 : 0) + (L_zeros_spliced.includes(x, -1) ? 2 : 0) + (L_zeros_spliced.includes() ? 4 : 0) + (L_zeros_spliced?.includes(x) ? 8 : 0) + ([].includes.call(L_zeros_spliced, x) ? 16 : 0); return s; }
function zeros_spliced_once(x) { return L_zeros_spliced.includes(x); }
function zeros_spliced_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { zeros_spliced_change(); } catch (e) { s += e.name; } } s += L_zeros_spliced.includes(list[i]) ? 1 : 0; } return s; }
function zeros_spliced_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_zeros_spliced.splice(0, 1, "ab"); } catch (e) { s += e.name; } } s += L_zeros_spliced.includes(list[i]) ? 1 : 0; s += L_zeros_spliced.length; } return s; }
const L_zeros_deleted = [0, -1];
function zeros_deleted_change() { delete L_zeros_deleted[0]; }
function zeros_deleted_of(list) { let s = ""; for (const x of list) s += L_zeros_deleted.includes(x) ? 1 : 0; return s; }
function zeros_deleted_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_zeros_deleted.includes(list[i])) h += i; else h -= 1; return h; }
function zeros_deleted_filter(list) { return list.filter(x => L_zeros_deleted.includes(x)).length; }
function zeros_deleted_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_zeros_deleted.includes(x)) continue; s += i; } return s; }
function zeros_deleted_second(list) { let s = ""; for (const x of list) s += (L_zeros_deleted.includes(x, 1) ? 1 : 0) + (L_zeros_deleted.includes(x, -1) ? 2 : 0) + (L_zeros_deleted.includes() ? 4 : 0) + (L_zeros_deleted?.includes(x) ? 8 : 0) + ([].includes.call(L_zeros_deleted, x) ? 16 : 0); return s; }
function zeros_deleted_once(x) { return L_zeros_deleted.includes(x); }
function zeros_deleted_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { zeros_deleted_change(); } catch (e) { s += e.name; } } s += L_zeros_deleted.includes(list[i]) ? 1 : 0; } return s; }
function zeros_deleted_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { delete L_zeros_deleted[0]; } catch (e) { s += e.name; } } s += L_zeros_deleted.includes(list[i]) ? 1 : 0; s += L_zeros_deleted.length; } return s; }
const L_zeros_frozen = [0, -1];
function zeros_frozen_change() { Object.freeze(L_zeros_frozen); }
function zeros_frozen_of(list) { let s = ""; for (const x of list) s += L_zeros_frozen.includes(x) ? 1 : 0; return s; }
function zeros_frozen_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_zeros_frozen.includes(list[i])) h += i; else h -= 1; return h; }
function zeros_frozen_filter(list) { return list.filter(x => L_zeros_frozen.includes(x)).length; }
function zeros_frozen_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_zeros_frozen.includes(x)) continue; s += i; } return s; }
function zeros_frozen_second(list) { let s = ""; for (const x of list) s += (L_zeros_frozen.includes(x, 1) ? 1 : 0) + (L_zeros_frozen.includes(x, -1) ? 2 : 0) + (L_zeros_frozen.includes() ? 4 : 0) + (L_zeros_frozen?.includes(x) ? 8 : 0) + ([].includes.call(L_zeros_frozen, x) ? 16 : 0); return s; }
function zeros_frozen_once(x) { return L_zeros_frozen.includes(x); }
function zeros_frozen_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { zeros_frozen_change(); } catch (e) { s += e.name; } } s += L_zeros_frozen.includes(list[i]) ? 1 : 0; } return s; }
function zeros_frozen_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { Object.freeze(L_zeros_frozen); } catch (e) { s += e.name; } } s += L_zeros_frozen.includes(list[i]) ? 1 : 0; s += L_zeros_frozen.length; } return s; }
const L_zeros_aliased = [0, -1];
function zeros_aliased_change() { (alias => { alias[0] = "é"; })(L_zeros_aliased); }
function zeros_aliased_of(list) { let s = ""; for (const x of list) s += L_zeros_aliased.includes(x) ? 1 : 0; return s; }
function zeros_aliased_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_zeros_aliased.includes(list[i])) h += i; else h -= 1; return h; }
function zeros_aliased_filter(list) { return list.filter(x => L_zeros_aliased.includes(x)).length; }
function zeros_aliased_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_zeros_aliased.includes(x)) continue; s += i; } return s; }
function zeros_aliased_second(list) { let s = ""; for (const x of list) s += (L_zeros_aliased.includes(x, 1) ? 1 : 0) + (L_zeros_aliased.includes(x, -1) ? 2 : 0) + (L_zeros_aliased.includes() ? 4 : 0) + (L_zeros_aliased?.includes(x) ? 8 : 0) + ([].includes.call(L_zeros_aliased, x) ? 16 : 0); return s; }
function zeros_aliased_once(x) { return L_zeros_aliased.includes(x); }
function zeros_aliased_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { zeros_aliased_change(); } catch (e) { s += e.name; } } s += L_zeros_aliased.includes(list[i]) ? 1 : 0; } return s; }
function zeros_aliased_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { (alias => { alias[0] = "é"; })(L_zeros_aliased); } catch (e) { s += e.name; } } s += L_zeros_aliased.includes(list[i]) ? 1 : 0; s += L_zeros_aliased.length; } return s; }
const L_zeros_own = [0, -1];
function zeros_own_change() { L_zeros_own.includes = x => x === "a"; }
function zeros_own_of(list) { let s = ""; for (const x of list) s += L_zeros_own.includes(x) ? 1 : 0; return s; }
function zeros_own_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_zeros_own.includes(list[i])) h += i; else h -= 1; return h; }
function zeros_own_filter(list) { return list.filter(x => L_zeros_own.includes(x)).length; }
function zeros_own_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_zeros_own.includes(x)) continue; s += i; } return s; }
function zeros_own_second(list) { let s = ""; for (const x of list) s += (L_zeros_own.includes(x, 1) ? 1 : 0) + (L_zeros_own.includes(x, -1) ? 2 : 0) + (L_zeros_own.includes() ? 4 : 0) + (L_zeros_own?.includes(x) ? 8 : 0) + ([].includes.call(L_zeros_own, x) ? 16 : 0); return s; }
function zeros_own_once(x) { return L_zeros_own.includes(x); }
function zeros_own_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { zeros_own_change(); } catch (e) { s += e.name; } } s += L_zeros_own.includes(list[i]) ? 1 : 0; } return s; }
function zeros_own_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_zeros_own.includes = x => x === "a"; } catch (e) { s += e.name; } } s += L_zeros_own.includes(list[i]) ? 1 : 0; s += L_zeros_own.length; } return s; }
const L_doubles_kept = [0.5, 1.5, 1e300];
function doubles_kept_change() { ; }
function doubles_kept_of(list) { let s = ""; for (const x of list) s += L_doubles_kept.includes(x) ? 1 : 0; return s; }
function doubles_kept_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_doubles_kept.includes(list[i])) h += i; else h -= 1; return h; }
function doubles_kept_filter(list) { return list.filter(x => L_doubles_kept.includes(x)).length; }
function doubles_kept_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_doubles_kept.includes(x)) continue; s += i; } return s; }
function doubles_kept_second(list) { let s = ""; for (const x of list) s += (L_doubles_kept.includes(x, 1) ? 1 : 0) + (L_doubles_kept.includes(x, -1) ? 2 : 0) + (L_doubles_kept.includes() ? 4 : 0) + (L_doubles_kept?.includes(x) ? 8 : 0) + ([].includes.call(L_doubles_kept, x) ? 16 : 0); return s; }
function doubles_kept_once(x) { return L_doubles_kept.includes(x); }
function doubles_kept_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { doubles_kept_change(); } catch (e) { s += e.name; } } s += L_doubles_kept.includes(list[i]) ? 1 : 0; } return s; }
function doubles_kept_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { ; } catch (e) { s += e.name; } } s += L_doubles_kept.includes(list[i]) ? 1 : 0; s += L_doubles_kept.length; } return s; }
const L_doubles_pushed = [0.5, 1.5, 1e300];
function doubles_pushed_change() { L_doubles_pushed.push("g9", 2); }
function doubles_pushed_of(list) { let s = ""; for (const x of list) s += L_doubles_pushed.includes(x) ? 1 : 0; return s; }
function doubles_pushed_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_doubles_pushed.includes(list[i])) h += i; else h -= 1; return h; }
function doubles_pushed_filter(list) { return list.filter(x => L_doubles_pushed.includes(x)).length; }
function doubles_pushed_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_doubles_pushed.includes(x)) continue; s += i; } return s; }
function doubles_pushed_second(list) { let s = ""; for (const x of list) s += (L_doubles_pushed.includes(x, 1) ? 1 : 0) + (L_doubles_pushed.includes(x, -1) ? 2 : 0) + (L_doubles_pushed.includes() ? 4 : 0) + (L_doubles_pushed?.includes(x) ? 8 : 0) + ([].includes.call(L_doubles_pushed, x) ? 16 : 0); return s; }
function doubles_pushed_once(x) { return L_doubles_pushed.includes(x); }
function doubles_pushed_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { doubles_pushed_change(); } catch (e) { s += e.name; } } s += L_doubles_pushed.includes(list[i]) ? 1 : 0; } return s; }
function doubles_pushed_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_doubles_pushed.push("g9", 2); } catch (e) { s += e.name; } } s += L_doubles_pushed.includes(list[i]) ? 1 : 0; s += L_doubles_pushed.length; } return s; }
const L_doubles_stored = [0.5, 1.5, 1e300];
function doubles_stored_change() { L_doubles_stored[0] = "g2"; }
function doubles_stored_of(list) { let s = ""; for (const x of list) s += L_doubles_stored.includes(x) ? 1 : 0; return s; }
function doubles_stored_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_doubles_stored.includes(list[i])) h += i; else h -= 1; return h; }
function doubles_stored_filter(list) { return list.filter(x => L_doubles_stored.includes(x)).length; }
function doubles_stored_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_doubles_stored.includes(x)) continue; s += i; } return s; }
function doubles_stored_second(list) { let s = ""; for (const x of list) s += (L_doubles_stored.includes(x, 1) ? 1 : 0) + (L_doubles_stored.includes(x, -1) ? 2 : 0) + (L_doubles_stored.includes() ? 4 : 0) + (L_doubles_stored?.includes(x) ? 8 : 0) + ([].includes.call(L_doubles_stored, x) ? 16 : 0); return s; }
function doubles_stored_once(x) { return L_doubles_stored.includes(x); }
function doubles_stored_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { doubles_stored_change(); } catch (e) { s += e.name; } } s += L_doubles_stored.includes(list[i]) ? 1 : 0; } return s; }
function doubles_stored_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_doubles_stored[0] = "g2"; } catch (e) { s += e.name; } } s += L_doubles_stored.includes(list[i]) ? 1 : 0; s += L_doubles_stored.length; } return s; }
const L_doubles_storedNumber = [0.5, 1.5, 1e300];
function doubles_storedNumber_change() { L_doubles_storedNumber[1] = 5; }
function doubles_storedNumber_of(list) { let s = ""; for (const x of list) s += L_doubles_storedNumber.includes(x) ? 1 : 0; return s; }
function doubles_storedNumber_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_doubles_storedNumber.includes(list[i])) h += i; else h -= 1; return h; }
function doubles_storedNumber_filter(list) { return list.filter(x => L_doubles_storedNumber.includes(x)).length; }
function doubles_storedNumber_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_doubles_storedNumber.includes(x)) continue; s += i; } return s; }
function doubles_storedNumber_second(list) { let s = ""; for (const x of list) s += (L_doubles_storedNumber.includes(x, 1) ? 1 : 0) + (L_doubles_storedNumber.includes(x, -1) ? 2 : 0) + (L_doubles_storedNumber.includes() ? 4 : 0) + (L_doubles_storedNumber?.includes(x) ? 8 : 0) + ([].includes.call(L_doubles_storedNumber, x) ? 16 : 0); return s; }
function doubles_storedNumber_once(x) { return L_doubles_storedNumber.includes(x); }
function doubles_storedNumber_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { doubles_storedNumber_change(); } catch (e) { s += e.name; } } s += L_doubles_storedNumber.includes(list[i]) ? 1 : 0; } return s; }
function doubles_storedNumber_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_doubles_storedNumber[1] = 5; } catch (e) { s += e.name; } } s += L_doubles_storedNumber.includes(list[i]) ? 1 : 0; s += L_doubles_storedNumber.length; } return s; }
const L_doubles_sorted = [0.5, 1.5, 1e300];
function doubles_sorted_change() { L_doubles_sorted.sort(); }
function doubles_sorted_of(list) { let s = ""; for (const x of list) s += L_doubles_sorted.includes(x) ? 1 : 0; return s; }
function doubles_sorted_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_doubles_sorted.includes(list[i])) h += i; else h -= 1; return h; }
function doubles_sorted_filter(list) { return list.filter(x => L_doubles_sorted.includes(x)).length; }
function doubles_sorted_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_doubles_sorted.includes(x)) continue; s += i; } return s; }
function doubles_sorted_second(list) { let s = ""; for (const x of list) s += (L_doubles_sorted.includes(x, 1) ? 1 : 0) + (L_doubles_sorted.includes(x, -1) ? 2 : 0) + (L_doubles_sorted.includes() ? 4 : 0) + (L_doubles_sorted?.includes(x) ? 8 : 0) + ([].includes.call(L_doubles_sorted, x) ? 16 : 0); return s; }
function doubles_sorted_once(x) { return L_doubles_sorted.includes(x); }
function doubles_sorted_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { doubles_sorted_change(); } catch (e) { s += e.name; } } s += L_doubles_sorted.includes(list[i]) ? 1 : 0; } return s; }
function doubles_sorted_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_doubles_sorted.sort(); } catch (e) { s += e.name; } } s += L_doubles_sorted.includes(list[i]) ? 1 : 0; s += L_doubles_sorted.length; } return s; }
const L_doubles_shortened = [0.5, 1.5, 1e300];
function doubles_shortened_change() { L_doubles_shortened.length = Math.min(1, L_doubles_shortened.length); }
function doubles_shortened_of(list) { let s = ""; for (const x of list) s += L_doubles_shortened.includes(x) ? 1 : 0; return s; }
function doubles_shortened_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_doubles_shortened.includes(list[i])) h += i; else h -= 1; return h; }
function doubles_shortened_filter(list) { return list.filter(x => L_doubles_shortened.includes(x)).length; }
function doubles_shortened_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_doubles_shortened.includes(x)) continue; s += i; } return s; }
function doubles_shortened_second(list) { let s = ""; for (const x of list) s += (L_doubles_shortened.includes(x, 1) ? 1 : 0) + (L_doubles_shortened.includes(x, -1) ? 2 : 0) + (L_doubles_shortened.includes() ? 4 : 0) + (L_doubles_shortened?.includes(x) ? 8 : 0) + ([].includes.call(L_doubles_shortened, x) ? 16 : 0); return s; }
function doubles_shortened_once(x) { return L_doubles_shortened.includes(x); }
function doubles_shortened_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { doubles_shortened_change(); } catch (e) { s += e.name; } } s += L_doubles_shortened.includes(list[i]) ? 1 : 0; } return s; }
function doubles_shortened_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_doubles_shortened.length = Math.min(1, L_doubles_shortened.length); } catch (e) { s += e.name; } } s += L_doubles_shortened.includes(list[i]) ? 1 : 0; s += L_doubles_shortened.length; } return s; }
const L_doubles_spliced = [0.5, 1.5, 1e300];
function doubles_spliced_change() { L_doubles_spliced.splice(0, 1, "ab"); }
function doubles_spliced_of(list) { let s = ""; for (const x of list) s += L_doubles_spliced.includes(x) ? 1 : 0; return s; }
function doubles_spliced_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_doubles_spliced.includes(list[i])) h += i; else h -= 1; return h; }
function doubles_spliced_filter(list) { return list.filter(x => L_doubles_spliced.includes(x)).length; }
function doubles_spliced_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_doubles_spliced.includes(x)) continue; s += i; } return s; }
function doubles_spliced_second(list) { let s = ""; for (const x of list) s += (L_doubles_spliced.includes(x, 1) ? 1 : 0) + (L_doubles_spliced.includes(x, -1) ? 2 : 0) + (L_doubles_spliced.includes() ? 4 : 0) + (L_doubles_spliced?.includes(x) ? 8 : 0) + ([].includes.call(L_doubles_spliced, x) ? 16 : 0); return s; }
function doubles_spliced_once(x) { return L_doubles_spliced.includes(x); }
function doubles_spliced_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { doubles_spliced_change(); } catch (e) { s += e.name; } } s += L_doubles_spliced.includes(list[i]) ? 1 : 0; } return s; }
function doubles_spliced_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_doubles_spliced.splice(0, 1, "ab"); } catch (e) { s += e.name; } } s += L_doubles_spliced.includes(list[i]) ? 1 : 0; s += L_doubles_spliced.length; } return s; }
const L_doubles_deleted = [0.5, 1.5, 1e300];
function doubles_deleted_change() { delete L_doubles_deleted[0]; }
function doubles_deleted_of(list) { let s = ""; for (const x of list) s += L_doubles_deleted.includes(x) ? 1 : 0; return s; }
function doubles_deleted_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_doubles_deleted.includes(list[i])) h += i; else h -= 1; return h; }
function doubles_deleted_filter(list) { return list.filter(x => L_doubles_deleted.includes(x)).length; }
function doubles_deleted_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_doubles_deleted.includes(x)) continue; s += i; } return s; }
function doubles_deleted_second(list) { let s = ""; for (const x of list) s += (L_doubles_deleted.includes(x, 1) ? 1 : 0) + (L_doubles_deleted.includes(x, -1) ? 2 : 0) + (L_doubles_deleted.includes() ? 4 : 0) + (L_doubles_deleted?.includes(x) ? 8 : 0) + ([].includes.call(L_doubles_deleted, x) ? 16 : 0); return s; }
function doubles_deleted_once(x) { return L_doubles_deleted.includes(x); }
function doubles_deleted_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { doubles_deleted_change(); } catch (e) { s += e.name; } } s += L_doubles_deleted.includes(list[i]) ? 1 : 0; } return s; }
function doubles_deleted_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { delete L_doubles_deleted[0]; } catch (e) { s += e.name; } } s += L_doubles_deleted.includes(list[i]) ? 1 : 0; s += L_doubles_deleted.length; } return s; }
const L_doubles_frozen = [0.5, 1.5, 1e300];
function doubles_frozen_change() { Object.freeze(L_doubles_frozen); }
function doubles_frozen_of(list) { let s = ""; for (const x of list) s += L_doubles_frozen.includes(x) ? 1 : 0; return s; }
function doubles_frozen_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_doubles_frozen.includes(list[i])) h += i; else h -= 1; return h; }
function doubles_frozen_filter(list) { return list.filter(x => L_doubles_frozen.includes(x)).length; }
function doubles_frozen_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_doubles_frozen.includes(x)) continue; s += i; } return s; }
function doubles_frozen_second(list) { let s = ""; for (const x of list) s += (L_doubles_frozen.includes(x, 1) ? 1 : 0) + (L_doubles_frozen.includes(x, -1) ? 2 : 0) + (L_doubles_frozen.includes() ? 4 : 0) + (L_doubles_frozen?.includes(x) ? 8 : 0) + ([].includes.call(L_doubles_frozen, x) ? 16 : 0); return s; }
function doubles_frozen_once(x) { return L_doubles_frozen.includes(x); }
function doubles_frozen_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { doubles_frozen_change(); } catch (e) { s += e.name; } } s += L_doubles_frozen.includes(list[i]) ? 1 : 0; } return s; }
function doubles_frozen_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { Object.freeze(L_doubles_frozen); } catch (e) { s += e.name; } } s += L_doubles_frozen.includes(list[i]) ? 1 : 0; s += L_doubles_frozen.length; } return s; }
const L_doubles_aliased = [0.5, 1.5, 1e300];
function doubles_aliased_change() { (alias => { alias[0] = "é"; })(L_doubles_aliased); }
function doubles_aliased_of(list) { let s = ""; for (const x of list) s += L_doubles_aliased.includes(x) ? 1 : 0; return s; }
function doubles_aliased_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_doubles_aliased.includes(list[i])) h += i; else h -= 1; return h; }
function doubles_aliased_filter(list) { return list.filter(x => L_doubles_aliased.includes(x)).length; }
function doubles_aliased_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_doubles_aliased.includes(x)) continue; s += i; } return s; }
function doubles_aliased_second(list) { let s = ""; for (const x of list) s += (L_doubles_aliased.includes(x, 1) ? 1 : 0) + (L_doubles_aliased.includes(x, -1) ? 2 : 0) + (L_doubles_aliased.includes() ? 4 : 0) + (L_doubles_aliased?.includes(x) ? 8 : 0) + ([].includes.call(L_doubles_aliased, x) ? 16 : 0); return s; }
function doubles_aliased_once(x) { return L_doubles_aliased.includes(x); }
function doubles_aliased_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { doubles_aliased_change(); } catch (e) { s += e.name; } } s += L_doubles_aliased.includes(list[i]) ? 1 : 0; } return s; }
function doubles_aliased_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { (alias => { alias[0] = "é"; })(L_doubles_aliased); } catch (e) { s += e.name; } } s += L_doubles_aliased.includes(list[i]) ? 1 : 0; s += L_doubles_aliased.length; } return s; }
const L_doubles_own = [0.5, 1.5, 1e300];
function doubles_own_change() { L_doubles_own.includes = x => x === "a"; }
function doubles_own_of(list) { let s = ""; for (const x of list) s += L_doubles_own.includes(x) ? 1 : 0; return s; }
function doubles_own_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_doubles_own.includes(list[i])) h += i; else h -= 1; return h; }
function doubles_own_filter(list) { return list.filter(x => L_doubles_own.includes(x)).length; }
function doubles_own_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_doubles_own.includes(x)) continue; s += i; } return s; }
function doubles_own_second(list) { let s = ""; for (const x of list) s += (L_doubles_own.includes(x, 1) ? 1 : 0) + (L_doubles_own.includes(x, -1) ? 2 : 0) + (L_doubles_own.includes() ? 4 : 0) + (L_doubles_own?.includes(x) ? 8 : 0) + ([].includes.call(L_doubles_own, x) ? 16 : 0); return s; }
function doubles_own_once(x) { return L_doubles_own.includes(x); }
function doubles_own_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { doubles_own_change(); } catch (e) { s += e.name; } } s += L_doubles_own.includes(list[i]) ? 1 : 0; } return s; }
function doubles_own_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_doubles_own.includes = x => x === "a"; } catch (e) { s += e.name; } } s += L_doubles_own.includes(list[i]) ? 1 : 0; s += L_doubles_own.length; } return s; }
const L_mixed_kept = ["a", 1, null, undefined, true];
function mixed_kept_change() { ; }
function mixed_kept_of(list) { let s = ""; for (const x of list) s += L_mixed_kept.includes(x) ? 1 : 0; return s; }
function mixed_kept_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_mixed_kept.includes(list[i])) h += i; else h -= 1; return h; }
function mixed_kept_filter(list) { return list.filter(x => L_mixed_kept.includes(x)).length; }
function mixed_kept_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_mixed_kept.includes(x)) continue; s += i; } return s; }
function mixed_kept_second(list) { let s = ""; for (const x of list) s += (L_mixed_kept.includes(x, 1) ? 1 : 0) + (L_mixed_kept.includes(x, -1) ? 2 : 0) + (L_mixed_kept.includes() ? 4 : 0) + (L_mixed_kept?.includes(x) ? 8 : 0) + ([].includes.call(L_mixed_kept, x) ? 16 : 0); return s; }
function mixed_kept_once(x) { return L_mixed_kept.includes(x); }
function mixed_kept_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { mixed_kept_change(); } catch (e) { s += e.name; } } s += L_mixed_kept.includes(list[i]) ? 1 : 0; } return s; }
function mixed_kept_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { ; } catch (e) { s += e.name; } } s += L_mixed_kept.includes(list[i]) ? 1 : 0; s += L_mixed_kept.length; } return s; }
const L_mixed_pushed = ["a", 1, null, undefined, true];
function mixed_pushed_change() { L_mixed_pushed.push("g9", 2); }
function mixed_pushed_of(list) { let s = ""; for (const x of list) s += L_mixed_pushed.includes(x) ? 1 : 0; return s; }
function mixed_pushed_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_mixed_pushed.includes(list[i])) h += i; else h -= 1; return h; }
function mixed_pushed_filter(list) { return list.filter(x => L_mixed_pushed.includes(x)).length; }
function mixed_pushed_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_mixed_pushed.includes(x)) continue; s += i; } return s; }
function mixed_pushed_second(list) { let s = ""; for (const x of list) s += (L_mixed_pushed.includes(x, 1) ? 1 : 0) + (L_mixed_pushed.includes(x, -1) ? 2 : 0) + (L_mixed_pushed.includes() ? 4 : 0) + (L_mixed_pushed?.includes(x) ? 8 : 0) + ([].includes.call(L_mixed_pushed, x) ? 16 : 0); return s; }
function mixed_pushed_once(x) { return L_mixed_pushed.includes(x); }
function mixed_pushed_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { mixed_pushed_change(); } catch (e) { s += e.name; } } s += L_mixed_pushed.includes(list[i]) ? 1 : 0; } return s; }
function mixed_pushed_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_mixed_pushed.push("g9", 2); } catch (e) { s += e.name; } } s += L_mixed_pushed.includes(list[i]) ? 1 : 0; s += L_mixed_pushed.length; } return s; }
const L_mixed_stored = ["a", 1, null, undefined, true];
function mixed_stored_change() { L_mixed_stored[0] = "g2"; }
function mixed_stored_of(list) { let s = ""; for (const x of list) s += L_mixed_stored.includes(x) ? 1 : 0; return s; }
function mixed_stored_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_mixed_stored.includes(list[i])) h += i; else h -= 1; return h; }
function mixed_stored_filter(list) { return list.filter(x => L_mixed_stored.includes(x)).length; }
function mixed_stored_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_mixed_stored.includes(x)) continue; s += i; } return s; }
function mixed_stored_second(list) { let s = ""; for (const x of list) s += (L_mixed_stored.includes(x, 1) ? 1 : 0) + (L_mixed_stored.includes(x, -1) ? 2 : 0) + (L_mixed_stored.includes() ? 4 : 0) + (L_mixed_stored?.includes(x) ? 8 : 0) + ([].includes.call(L_mixed_stored, x) ? 16 : 0); return s; }
function mixed_stored_once(x) { return L_mixed_stored.includes(x); }
function mixed_stored_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { mixed_stored_change(); } catch (e) { s += e.name; } } s += L_mixed_stored.includes(list[i]) ? 1 : 0; } return s; }
function mixed_stored_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_mixed_stored[0] = "g2"; } catch (e) { s += e.name; } } s += L_mixed_stored.includes(list[i]) ? 1 : 0; s += L_mixed_stored.length; } return s; }
const L_mixed_storedNumber = ["a", 1, null, undefined, true];
function mixed_storedNumber_change() { L_mixed_storedNumber[1] = 5; }
function mixed_storedNumber_of(list) { let s = ""; for (const x of list) s += L_mixed_storedNumber.includes(x) ? 1 : 0; return s; }
function mixed_storedNumber_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_mixed_storedNumber.includes(list[i])) h += i; else h -= 1; return h; }
function mixed_storedNumber_filter(list) { return list.filter(x => L_mixed_storedNumber.includes(x)).length; }
function mixed_storedNumber_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_mixed_storedNumber.includes(x)) continue; s += i; } return s; }
function mixed_storedNumber_second(list) { let s = ""; for (const x of list) s += (L_mixed_storedNumber.includes(x, 1) ? 1 : 0) + (L_mixed_storedNumber.includes(x, -1) ? 2 : 0) + (L_mixed_storedNumber.includes() ? 4 : 0) + (L_mixed_storedNumber?.includes(x) ? 8 : 0) + ([].includes.call(L_mixed_storedNumber, x) ? 16 : 0); return s; }
function mixed_storedNumber_once(x) { return L_mixed_storedNumber.includes(x); }
function mixed_storedNumber_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { mixed_storedNumber_change(); } catch (e) { s += e.name; } } s += L_mixed_storedNumber.includes(list[i]) ? 1 : 0; } return s; }
function mixed_storedNumber_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_mixed_storedNumber[1] = 5; } catch (e) { s += e.name; } } s += L_mixed_storedNumber.includes(list[i]) ? 1 : 0; s += L_mixed_storedNumber.length; } return s; }
const L_mixed_sorted = ["a", 1, null, undefined, true];
function mixed_sorted_change() { L_mixed_sorted.sort(); }
function mixed_sorted_of(list) { let s = ""; for (const x of list) s += L_mixed_sorted.includes(x) ? 1 : 0; return s; }
function mixed_sorted_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_mixed_sorted.includes(list[i])) h += i; else h -= 1; return h; }
function mixed_sorted_filter(list) { return list.filter(x => L_mixed_sorted.includes(x)).length; }
function mixed_sorted_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_mixed_sorted.includes(x)) continue; s += i; } return s; }
function mixed_sorted_second(list) { let s = ""; for (const x of list) s += (L_mixed_sorted.includes(x, 1) ? 1 : 0) + (L_mixed_sorted.includes(x, -1) ? 2 : 0) + (L_mixed_sorted.includes() ? 4 : 0) + (L_mixed_sorted?.includes(x) ? 8 : 0) + ([].includes.call(L_mixed_sorted, x) ? 16 : 0); return s; }
function mixed_sorted_once(x) { return L_mixed_sorted.includes(x); }
function mixed_sorted_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { mixed_sorted_change(); } catch (e) { s += e.name; } } s += L_mixed_sorted.includes(list[i]) ? 1 : 0; } return s; }
function mixed_sorted_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_mixed_sorted.sort(); } catch (e) { s += e.name; } } s += L_mixed_sorted.includes(list[i]) ? 1 : 0; s += L_mixed_sorted.length; } return s; }
const L_mixed_shortened = ["a", 1, null, undefined, true];
function mixed_shortened_change() { L_mixed_shortened.length = Math.min(1, L_mixed_shortened.length); }
function mixed_shortened_of(list) { let s = ""; for (const x of list) s += L_mixed_shortened.includes(x) ? 1 : 0; return s; }
function mixed_shortened_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_mixed_shortened.includes(list[i])) h += i; else h -= 1; return h; }
function mixed_shortened_filter(list) { return list.filter(x => L_mixed_shortened.includes(x)).length; }
function mixed_shortened_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_mixed_shortened.includes(x)) continue; s += i; } return s; }
function mixed_shortened_second(list) { let s = ""; for (const x of list) s += (L_mixed_shortened.includes(x, 1) ? 1 : 0) + (L_mixed_shortened.includes(x, -1) ? 2 : 0) + (L_mixed_shortened.includes() ? 4 : 0) + (L_mixed_shortened?.includes(x) ? 8 : 0) + ([].includes.call(L_mixed_shortened, x) ? 16 : 0); return s; }
function mixed_shortened_once(x) { return L_mixed_shortened.includes(x); }
function mixed_shortened_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { mixed_shortened_change(); } catch (e) { s += e.name; } } s += L_mixed_shortened.includes(list[i]) ? 1 : 0; } return s; }
function mixed_shortened_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_mixed_shortened.length = Math.min(1, L_mixed_shortened.length); } catch (e) { s += e.name; } } s += L_mixed_shortened.includes(list[i]) ? 1 : 0; s += L_mixed_shortened.length; } return s; }
const L_mixed_spliced = ["a", 1, null, undefined, true];
function mixed_spliced_change() { L_mixed_spliced.splice(0, 1, "ab"); }
function mixed_spliced_of(list) { let s = ""; for (const x of list) s += L_mixed_spliced.includes(x) ? 1 : 0; return s; }
function mixed_spliced_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_mixed_spliced.includes(list[i])) h += i; else h -= 1; return h; }
function mixed_spliced_filter(list) { return list.filter(x => L_mixed_spliced.includes(x)).length; }
function mixed_spliced_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_mixed_spliced.includes(x)) continue; s += i; } return s; }
function mixed_spliced_second(list) { let s = ""; for (const x of list) s += (L_mixed_spliced.includes(x, 1) ? 1 : 0) + (L_mixed_spliced.includes(x, -1) ? 2 : 0) + (L_mixed_spliced.includes() ? 4 : 0) + (L_mixed_spliced?.includes(x) ? 8 : 0) + ([].includes.call(L_mixed_spliced, x) ? 16 : 0); return s; }
function mixed_spliced_once(x) { return L_mixed_spliced.includes(x); }
function mixed_spliced_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { mixed_spliced_change(); } catch (e) { s += e.name; } } s += L_mixed_spliced.includes(list[i]) ? 1 : 0; } return s; }
function mixed_spliced_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_mixed_spliced.splice(0, 1, "ab"); } catch (e) { s += e.name; } } s += L_mixed_spliced.includes(list[i]) ? 1 : 0; s += L_mixed_spliced.length; } return s; }
const L_mixed_deleted = ["a", 1, null, undefined, true];
function mixed_deleted_change() { delete L_mixed_deleted[0]; }
function mixed_deleted_of(list) { let s = ""; for (const x of list) s += L_mixed_deleted.includes(x) ? 1 : 0; return s; }
function mixed_deleted_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_mixed_deleted.includes(list[i])) h += i; else h -= 1; return h; }
function mixed_deleted_filter(list) { return list.filter(x => L_mixed_deleted.includes(x)).length; }
function mixed_deleted_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_mixed_deleted.includes(x)) continue; s += i; } return s; }
function mixed_deleted_second(list) { let s = ""; for (const x of list) s += (L_mixed_deleted.includes(x, 1) ? 1 : 0) + (L_mixed_deleted.includes(x, -1) ? 2 : 0) + (L_mixed_deleted.includes() ? 4 : 0) + (L_mixed_deleted?.includes(x) ? 8 : 0) + ([].includes.call(L_mixed_deleted, x) ? 16 : 0); return s; }
function mixed_deleted_once(x) { return L_mixed_deleted.includes(x); }
function mixed_deleted_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { mixed_deleted_change(); } catch (e) { s += e.name; } } s += L_mixed_deleted.includes(list[i]) ? 1 : 0; } return s; }
function mixed_deleted_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { delete L_mixed_deleted[0]; } catch (e) { s += e.name; } } s += L_mixed_deleted.includes(list[i]) ? 1 : 0; s += L_mixed_deleted.length; } return s; }
const L_mixed_frozen = ["a", 1, null, undefined, true];
function mixed_frozen_change() { Object.freeze(L_mixed_frozen); }
function mixed_frozen_of(list) { let s = ""; for (const x of list) s += L_mixed_frozen.includes(x) ? 1 : 0; return s; }
function mixed_frozen_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_mixed_frozen.includes(list[i])) h += i; else h -= 1; return h; }
function mixed_frozen_filter(list) { return list.filter(x => L_mixed_frozen.includes(x)).length; }
function mixed_frozen_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_mixed_frozen.includes(x)) continue; s += i; } return s; }
function mixed_frozen_second(list) { let s = ""; for (const x of list) s += (L_mixed_frozen.includes(x, 1) ? 1 : 0) + (L_mixed_frozen.includes(x, -1) ? 2 : 0) + (L_mixed_frozen.includes() ? 4 : 0) + (L_mixed_frozen?.includes(x) ? 8 : 0) + ([].includes.call(L_mixed_frozen, x) ? 16 : 0); return s; }
function mixed_frozen_once(x) { return L_mixed_frozen.includes(x); }
function mixed_frozen_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { mixed_frozen_change(); } catch (e) { s += e.name; } } s += L_mixed_frozen.includes(list[i]) ? 1 : 0; } return s; }
function mixed_frozen_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { Object.freeze(L_mixed_frozen); } catch (e) { s += e.name; } } s += L_mixed_frozen.includes(list[i]) ? 1 : 0; s += L_mixed_frozen.length; } return s; }
const L_mixed_aliased = ["a", 1, null, undefined, true];
function mixed_aliased_change() { (alias => { alias[0] = "é"; })(L_mixed_aliased); }
function mixed_aliased_of(list) { let s = ""; for (const x of list) s += L_mixed_aliased.includes(x) ? 1 : 0; return s; }
function mixed_aliased_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_mixed_aliased.includes(list[i])) h += i; else h -= 1; return h; }
function mixed_aliased_filter(list) { return list.filter(x => L_mixed_aliased.includes(x)).length; }
function mixed_aliased_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_mixed_aliased.includes(x)) continue; s += i; } return s; }
function mixed_aliased_second(list) { let s = ""; for (const x of list) s += (L_mixed_aliased.includes(x, 1) ? 1 : 0) + (L_mixed_aliased.includes(x, -1) ? 2 : 0) + (L_mixed_aliased.includes() ? 4 : 0) + (L_mixed_aliased?.includes(x) ? 8 : 0) + ([].includes.call(L_mixed_aliased, x) ? 16 : 0); return s; }
function mixed_aliased_once(x) { return L_mixed_aliased.includes(x); }
function mixed_aliased_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { mixed_aliased_change(); } catch (e) { s += e.name; } } s += L_mixed_aliased.includes(list[i]) ? 1 : 0; } return s; }
function mixed_aliased_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { (alias => { alias[0] = "é"; })(L_mixed_aliased); } catch (e) { s += e.name; } } s += L_mixed_aliased.includes(list[i]) ? 1 : 0; s += L_mixed_aliased.length; } return s; }
const L_mixed_own = ["a", 1, null, undefined, true];
function mixed_own_change() { L_mixed_own.includes = x => x === "a"; }
function mixed_own_of(list) { let s = ""; for (const x of list) s += L_mixed_own.includes(x) ? 1 : 0; return s; }
function mixed_own_at(list) { let h = 0; for (let i = 0; i < list.length; i++) if (L_mixed_own.includes(list[i])) h += i; else h -= 1; return h; }
function mixed_own_filter(list) { return list.filter(x => L_mixed_own.includes(x)).length; }
function mixed_own_not(list) { let s = 0; let i = 0; while (i < list.length) { const x = list[i++]; if (typeof x !== "string") continue; if (!L_mixed_own.includes(x)) continue; s += i; } return s; }
function mixed_own_second(list) { let s = ""; for (const x of list) s += (L_mixed_own.includes(x, 1) ? 1 : 0) + (L_mixed_own.includes(x, -1) ? 2 : 0) + (L_mixed_own.includes() ? 4 : 0) + (L_mixed_own?.includes(x) ? 8 : 0) + ([].includes.call(L_mixed_own, x) ? 16 : 0); return s; }
function mixed_own_once(x) { return L_mixed_own.includes(x); }
function mixed_own_between(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 3) { try { mixed_own_change(); } catch (e) { s += e.name; } } s += L_mixed_own.includes(list[i]) ? 1 : 0; } return s; }
function mixed_own_here(list) { let s = ""; for (let i = 0; i < list.length; i++) { if (i === 5) { try { L_mixed_own.includes = x => x === "a"; } catch (e) { s += e.name; } } s += L_mixed_own.includes(list[i]) ? 1 : 0; s += L_mixed_own.length; } return s; }
const runs = [
  ["texts_kept", L_texts_kept, texts_kept_change, [texts_kept_of, texts_kept_at, texts_kept_filter, texts_kept_not, texts_kept_second], texts_kept_between, texts_kept_here, texts_kept_once],
  ["texts_pushed", L_texts_pushed, texts_pushed_change, [texts_pushed_of, texts_pushed_at, texts_pushed_filter, texts_pushed_not, texts_pushed_second], texts_pushed_between, texts_pushed_here, texts_pushed_once],
  ["texts_popped", L_texts_popped, texts_popped_change, [texts_popped_of, texts_popped_at, texts_popped_filter, texts_popped_not, texts_popped_second], texts_popped_between, texts_popped_here, texts_popped_once],
  ["texts_stored", L_texts_stored, texts_stored_change, [texts_stored_of, texts_stored_at, texts_stored_filter, texts_stored_not, texts_stored_second], texts_stored_between, texts_stored_here, texts_stored_once],
  ["texts_storedNumber", L_texts_storedNumber, texts_storedNumber_change, [texts_storedNumber_of, texts_storedNumber_at, texts_storedNumber_filter, texts_storedNumber_not, texts_storedNumber_second], texts_storedNumber_between, texts_storedNumber_here, texts_storedNumber_once],
  ["texts_storedAfar", L_texts_storedAfar, texts_storedAfar_change, [texts_storedAfar_of, texts_storedAfar_at, texts_storedAfar_filter, texts_storedAfar_not, texts_storedAfar_second], texts_storedAfar_between, texts_storedAfar_here, texts_storedAfar_once],
  ["texts_sorted", L_texts_sorted, texts_sorted_change, [texts_sorted_of, texts_sorted_at, texts_sorted_filter, texts_sorted_not, texts_sorted_second], texts_sorted_between, texts_sorted_here, texts_sorted_once],
  ["texts_reversed", L_texts_reversed, texts_reversed_change, [texts_reversed_of, texts_reversed_at, texts_reversed_filter, texts_reversed_not, texts_reversed_second], texts_reversed_between, texts_reversed_here, texts_reversed_once],
  ["texts_shortened", L_texts_shortened, texts_shortened_change, [texts_shortened_of, texts_shortened_at, texts_shortened_filter, texts_shortened_not, texts_shortened_second], texts_shortened_between, texts_shortened_here, texts_shortened_once],
  ["texts_emptied", L_texts_emptied, texts_emptied_change, [texts_emptied_of, texts_emptied_at, texts_emptied_filter, texts_emptied_not, texts_emptied_second], texts_emptied_between, texts_emptied_here, texts_emptied_once],
  ["texts_spliced", L_texts_spliced, texts_spliced_change, [texts_spliced_of, texts_spliced_at, texts_spliced_filter, texts_spliced_not, texts_spliced_second], texts_spliced_between, texts_spliced_here, texts_spliced_once],
  ["texts_shifted", L_texts_shifted, texts_shifted_change, [texts_shifted_of, texts_shifted_at, texts_shifted_filter, texts_shifted_not, texts_shifted_second], texts_shifted_between, texts_shifted_here, texts_shifted_once],
  ["texts_unshifted", L_texts_unshifted, texts_unshifted_change, [texts_unshifted_of, texts_unshifted_at, texts_unshifted_filter, texts_unshifted_not, texts_unshifted_second], texts_unshifted_between, texts_unshifted_here, texts_unshifted_once],
  ["texts_filled", L_texts_filled, texts_filled_change, [texts_filled_of, texts_filled_at, texts_filled_filter, texts_filled_not, texts_filled_second], texts_filled_between, texts_filled_here, texts_filled_once],
  ["texts_deleted", L_texts_deleted, texts_deleted_change, [texts_deleted_of, texts_deleted_at, texts_deleted_filter, texts_deleted_not, texts_deleted_second], texts_deleted_between, texts_deleted_here, texts_deleted_once],
  ["texts_frozen", L_texts_frozen, texts_frozen_change, [texts_frozen_of, texts_frozen_at, texts_frozen_filter, texts_frozen_not, texts_frozen_second], texts_frozen_between, texts_frozen_here, texts_frozen_once],
  ["texts_aliased", L_texts_aliased, texts_aliased_change, [texts_aliased_of, texts_aliased_at, texts_aliased_filter, texts_aliased_not, texts_aliased_second], texts_aliased_between, texts_aliased_here, texts_aliased_once],
  ["texts_own", L_texts_own, texts_own_change, [texts_own_of, texts_own_at, texts_own_filter, texts_own_not, texts_own_second], texts_own_between, texts_own_here, texts_own_once],
  ["nine_kept", L_nine_kept, nine_kept_change, [nine_kept_of, nine_kept_at, nine_kept_filter, nine_kept_not, nine_kept_second], nine_kept_between, nine_kept_here, nine_kept_once],
  ["nine_pushed", L_nine_pushed, nine_pushed_change, [nine_pushed_of, nine_pushed_at, nine_pushed_filter, nine_pushed_not, nine_pushed_second], nine_pushed_between, nine_pushed_here, nine_pushed_once],
  ["nine_stored", L_nine_stored, nine_stored_change, [nine_stored_of, nine_stored_at, nine_stored_filter, nine_stored_not, nine_stored_second], nine_stored_between, nine_stored_here, nine_stored_once],
  ["nine_storedNumber", L_nine_storedNumber, nine_storedNumber_change, [nine_storedNumber_of, nine_storedNumber_at, nine_storedNumber_filter, nine_storedNumber_not, nine_storedNumber_second], nine_storedNumber_between, nine_storedNumber_here, nine_storedNumber_once],
  ["nine_sorted", L_nine_sorted, nine_sorted_change, [nine_sorted_of, nine_sorted_at, nine_sorted_filter, nine_sorted_not, nine_sorted_second], nine_sorted_between, nine_sorted_here, nine_sorted_once],
  ["nine_shortened", L_nine_shortened, nine_shortened_change, [nine_shortened_of, nine_shortened_at, nine_shortened_filter, nine_shortened_not, nine_shortened_second], nine_shortened_between, nine_shortened_here, nine_shortened_once],
  ["nine_spliced", L_nine_spliced, nine_spliced_change, [nine_spliced_of, nine_spliced_at, nine_spliced_filter, nine_spliced_not, nine_spliced_second], nine_spliced_between, nine_spliced_here, nine_spliced_once],
  ["nine_deleted", L_nine_deleted, nine_deleted_change, [nine_deleted_of, nine_deleted_at, nine_deleted_filter, nine_deleted_not, nine_deleted_second], nine_deleted_between, nine_deleted_here, nine_deleted_once],
  ["nine_frozen", L_nine_frozen, nine_frozen_change, [nine_frozen_of, nine_frozen_at, nine_frozen_filter, nine_frozen_not, nine_frozen_second], nine_frozen_between, nine_frozen_here, nine_frozen_once],
  ["nine_aliased", L_nine_aliased, nine_aliased_change, [nine_aliased_of, nine_aliased_at, nine_aliased_filter, nine_aliased_not, nine_aliased_second], nine_aliased_between, nine_aliased_here, nine_aliased_once],
  ["nine_own", L_nine_own, nine_own_change, [nine_own_of, nine_own_at, nine_own_filter, nine_own_not, nine_own_second], nine_own_between, nine_own_here, nine_own_once],
  ["zeros_kept", L_zeros_kept, zeros_kept_change, [zeros_kept_of, zeros_kept_at, zeros_kept_filter, zeros_kept_not, zeros_kept_second], zeros_kept_between, zeros_kept_here, zeros_kept_once],
  ["zeros_pushed", L_zeros_pushed, zeros_pushed_change, [zeros_pushed_of, zeros_pushed_at, zeros_pushed_filter, zeros_pushed_not, zeros_pushed_second], zeros_pushed_between, zeros_pushed_here, zeros_pushed_once],
  ["zeros_stored", L_zeros_stored, zeros_stored_change, [zeros_stored_of, zeros_stored_at, zeros_stored_filter, zeros_stored_not, zeros_stored_second], zeros_stored_between, zeros_stored_here, zeros_stored_once],
  ["zeros_storedNumber", L_zeros_storedNumber, zeros_storedNumber_change, [zeros_storedNumber_of, zeros_storedNumber_at, zeros_storedNumber_filter, zeros_storedNumber_not, zeros_storedNumber_second], zeros_storedNumber_between, zeros_storedNumber_here, zeros_storedNumber_once],
  ["zeros_sorted", L_zeros_sorted, zeros_sorted_change, [zeros_sorted_of, zeros_sorted_at, zeros_sorted_filter, zeros_sorted_not, zeros_sorted_second], zeros_sorted_between, zeros_sorted_here, zeros_sorted_once],
  ["zeros_shortened", L_zeros_shortened, zeros_shortened_change, [zeros_shortened_of, zeros_shortened_at, zeros_shortened_filter, zeros_shortened_not, zeros_shortened_second], zeros_shortened_between, zeros_shortened_here, zeros_shortened_once],
  ["zeros_spliced", L_zeros_spliced, zeros_spliced_change, [zeros_spliced_of, zeros_spliced_at, zeros_spliced_filter, zeros_spliced_not, zeros_spliced_second], zeros_spliced_between, zeros_spliced_here, zeros_spliced_once],
  ["zeros_deleted", L_zeros_deleted, zeros_deleted_change, [zeros_deleted_of, zeros_deleted_at, zeros_deleted_filter, zeros_deleted_not, zeros_deleted_second], zeros_deleted_between, zeros_deleted_here, zeros_deleted_once],
  ["zeros_frozen", L_zeros_frozen, zeros_frozen_change, [zeros_frozen_of, zeros_frozen_at, zeros_frozen_filter, zeros_frozen_not, zeros_frozen_second], zeros_frozen_between, zeros_frozen_here, zeros_frozen_once],
  ["zeros_aliased", L_zeros_aliased, zeros_aliased_change, [zeros_aliased_of, zeros_aliased_at, zeros_aliased_filter, zeros_aliased_not, zeros_aliased_second], zeros_aliased_between, zeros_aliased_here, zeros_aliased_once],
  ["zeros_own", L_zeros_own, zeros_own_change, [zeros_own_of, zeros_own_at, zeros_own_filter, zeros_own_not, zeros_own_second], zeros_own_between, zeros_own_here, zeros_own_once],
  ["doubles_kept", L_doubles_kept, doubles_kept_change, [doubles_kept_of, doubles_kept_at, doubles_kept_filter, doubles_kept_not, doubles_kept_second], doubles_kept_between, doubles_kept_here, doubles_kept_once],
  ["doubles_pushed", L_doubles_pushed, doubles_pushed_change, [doubles_pushed_of, doubles_pushed_at, doubles_pushed_filter, doubles_pushed_not, doubles_pushed_second], doubles_pushed_between, doubles_pushed_here, doubles_pushed_once],
  ["doubles_stored", L_doubles_stored, doubles_stored_change, [doubles_stored_of, doubles_stored_at, doubles_stored_filter, doubles_stored_not, doubles_stored_second], doubles_stored_between, doubles_stored_here, doubles_stored_once],
  ["doubles_storedNumber", L_doubles_storedNumber, doubles_storedNumber_change, [doubles_storedNumber_of, doubles_storedNumber_at, doubles_storedNumber_filter, doubles_storedNumber_not, doubles_storedNumber_second], doubles_storedNumber_between, doubles_storedNumber_here, doubles_storedNumber_once],
  ["doubles_sorted", L_doubles_sorted, doubles_sorted_change, [doubles_sorted_of, doubles_sorted_at, doubles_sorted_filter, doubles_sorted_not, doubles_sorted_second], doubles_sorted_between, doubles_sorted_here, doubles_sorted_once],
  ["doubles_shortened", L_doubles_shortened, doubles_shortened_change, [doubles_shortened_of, doubles_shortened_at, doubles_shortened_filter, doubles_shortened_not, doubles_shortened_second], doubles_shortened_between, doubles_shortened_here, doubles_shortened_once],
  ["doubles_spliced", L_doubles_spliced, doubles_spliced_change, [doubles_spliced_of, doubles_spliced_at, doubles_spliced_filter, doubles_spliced_not, doubles_spliced_second], doubles_spliced_between, doubles_spliced_here, doubles_spliced_once],
  ["doubles_deleted", L_doubles_deleted, doubles_deleted_change, [doubles_deleted_of, doubles_deleted_at, doubles_deleted_filter, doubles_deleted_not, doubles_deleted_second], doubles_deleted_between, doubles_deleted_here, doubles_deleted_once],
  ["doubles_frozen", L_doubles_frozen, doubles_frozen_change, [doubles_frozen_of, doubles_frozen_at, doubles_frozen_filter, doubles_frozen_not, doubles_frozen_second], doubles_frozen_between, doubles_frozen_here, doubles_frozen_once],
  ["doubles_aliased", L_doubles_aliased, doubles_aliased_change, [doubles_aliased_of, doubles_aliased_at, doubles_aliased_filter, doubles_aliased_not, doubles_aliased_second], doubles_aliased_between, doubles_aliased_here, doubles_aliased_once],
  ["doubles_own", L_doubles_own, doubles_own_change, [doubles_own_of, doubles_own_at, doubles_own_filter, doubles_own_not, doubles_own_second], doubles_own_between, doubles_own_here, doubles_own_once],
  ["mixed_kept", L_mixed_kept, mixed_kept_change, [mixed_kept_of, mixed_kept_at, mixed_kept_filter, mixed_kept_not, mixed_kept_second], mixed_kept_between, mixed_kept_here, mixed_kept_once],
  ["mixed_pushed", L_mixed_pushed, mixed_pushed_change, [mixed_pushed_of, mixed_pushed_at, mixed_pushed_filter, mixed_pushed_not, mixed_pushed_second], mixed_pushed_between, mixed_pushed_here, mixed_pushed_once],
  ["mixed_stored", L_mixed_stored, mixed_stored_change, [mixed_stored_of, mixed_stored_at, mixed_stored_filter, mixed_stored_not, mixed_stored_second], mixed_stored_between, mixed_stored_here, mixed_stored_once],
  ["mixed_storedNumber", L_mixed_storedNumber, mixed_storedNumber_change, [mixed_storedNumber_of, mixed_storedNumber_at, mixed_storedNumber_filter, mixed_storedNumber_not, mixed_storedNumber_second], mixed_storedNumber_between, mixed_storedNumber_here, mixed_storedNumber_once],
  ["mixed_sorted", L_mixed_sorted, mixed_sorted_change, [mixed_sorted_of, mixed_sorted_at, mixed_sorted_filter, mixed_sorted_not, mixed_sorted_second], mixed_sorted_between, mixed_sorted_here, mixed_sorted_once],
  ["mixed_shortened", L_mixed_shortened, mixed_shortened_change, [mixed_shortened_of, mixed_shortened_at, mixed_shortened_filter, mixed_shortened_not, mixed_shortened_second], mixed_shortened_between, mixed_shortened_here, mixed_shortened_once],
  ["mixed_spliced", L_mixed_spliced, mixed_spliced_change, [mixed_spliced_of, mixed_spliced_at, mixed_spliced_filter, mixed_spliced_not, mixed_spliced_second], mixed_spliced_between, mixed_spliced_here, mixed_spliced_once],
  ["mixed_deleted", L_mixed_deleted, mixed_deleted_change, [mixed_deleted_of, mixed_deleted_at, mixed_deleted_filter, mixed_deleted_not, mixed_deleted_second], mixed_deleted_between, mixed_deleted_here, mixed_deleted_once],
  ["mixed_frozen", L_mixed_frozen, mixed_frozen_change, [mixed_frozen_of, mixed_frozen_at, mixed_frozen_filter, mixed_frozen_not, mixed_frozen_second], mixed_frozen_between, mixed_frozen_here, mixed_frozen_once],
  ["mixed_aliased", L_mixed_aliased, mixed_aliased_change, [mixed_aliased_of, mixed_aliased_at, mixed_aliased_filter, mixed_aliased_not, mixed_aliased_second], mixed_aliased_between, mixed_aliased_here, mixed_aliased_once],
  ["mixed_own", L_mixed_own, mixed_own_change, [mixed_own_of, mixed_own_at, mixed_own_filter, mixed_own_not, mixed_own_second], mixed_own_between, mixed_own_here, mixed_own_once],
];
for (const [name, list, change, readers, between, here, once] of runs) {
  for (const reader of readers) for (const list of [strings, numbers, sought]) say(name + " before " + reader(list));
  say(name + " " + between(strings)); say(name + " " + between(sought));
  for (const reader of readers) for (const list of [strings, numbers, sought]) say(name + " after " + reader(list));
  say(name + " " + here(strings)); say(name + " " + here(numbers)); say(name + " " + here(sought));
  for (const x of sought) say(name + " once " + once(x));
  say(name + " holds " + list.map(String).join() + " " + list.length + " " + Object.keys(list).join());
}
function made(kinds, change) { const held = kinds === 0 ? ["g1", "g3"] : ["a"]; const inner = [1, 5]; const own = ["g1", "ab", "é"]; return { count(list) { let h = 0; for (const x of list) { if (own.includes(x)) h += 3; if (held.includes(x)) h += 5; if (inner.includes(x)) h += 7; } return h; }, change() { change(own); change(inner); } }; }
class Kinds { static all = ["g1", "g3", "ab"]; static #hidden = ["a", "g5"]; list = ["é", "g1"]; count(list) { let h = 0; for (const x of list) { if (Kinds.all.includes(x)) h += 1; if (Kinds.#hidden.includes(x)) h += 10; if (this.list.includes(x)) h += 100; } return h; } static change(f) { f(Kinds.all); f(Kinds.#hidden); } }
const doings = [l => l, l => l.push("b"), l => l.pop(), l => { l[0] = "longer text here"; }, l => l.sort().reverse(), l => { l.length = 0; }, l => Object.freeze(l), l => { l[5] = "a"; }];
for (const f of doings) for (const kind of [0, 1]) { const m = made(kind, f); say(m.count(strings) + " " + m.count(sought)); try { m.change(); } catch (e) { say(e.name); } say(m.count(strings) + " " + m.count(numbers) + " " + m.count(sought)); }
for (const f of doings) { const k = new Kinds(); say(k.count(strings) + " " + k.count(sought)); try { Kinds.change(f); f(k.list); } catch (e) { say(e.name); } say(k.count(strings) + " " + k.count(numbers) + " " + k.count(sought)); }
console.log("sum", lines, hash);
