const turns = Number(process.argv[2] ?? 2);
const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "function" ? "function " + v.name : typeof v === "bigint" ? v + "n" : v); } catch (e) { return String(e); } };
let seen = "";
const sources = JSON.parse("[[1,2,3,4,5,6,7,8,9],[0.5,1.5,-2.5,3],[],[7]]");
function twice_filter(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).filter(v => v === v); return got; }
function twice_reduce(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).reduce((t, v) => t + String(v) + " ", ""); return got; }
function twice_some(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).some(v => v !== v); return got; }
function twice_every(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).every(v => typeof v === "number"); return got; }
function twice_find(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).find(v => v > 3); return got; }
function twice_findIndex(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).findIndex(v => v > 3); return got; }
function twice_forEach(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).forEach(v => { seen += typeof v; }); return got; }
function twice_map(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).map(v => typeof v); return got; }
function twice_indexOfNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).indexOf(NaN); return got; }
function twice_includesNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).includes(NaN); return got; }
function twice_includesZero(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).includes(0); return got; }
function twice_join(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).join("|"); return got; }
function twice_slice(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).slice(1, 3); return got; }
function twice_concat(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).concat([1.5]); return got; }
function twice_reverse(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).reverse(); return got; }
function twice_at(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).at(-1); return got; }
function twice_push(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).push(0.5); return got; }
function twice_pop(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).pop(); return got; }
function twice_sort(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).sort(); return got; }
function twice_fill(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 2).fill(0.25, 1, 2); return got; }
function half_filter(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).filter(v => v === v); return got; }
function half_reduce(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).reduce((t, v) => t + String(v) + " ", ""); return got; }
function half_some(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).some(v => v !== v); return got; }
function half_every(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).every(v => typeof v === "number"); return got; }
function half_find(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).find(v => v > 3); return got; }
function half_findIndex(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).findIndex(v => v > 3); return got; }
function half_forEach(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).forEach(v => { seen += typeof v; }); return got; }
function half_map(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).map(v => typeof v); return got; }
function half_indexOfNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).indexOf(NaN); return got; }
function half_includesNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).includes(NaN); return got; }
function half_includesZero(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).includes(0); return got; }
function half_join(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).join("|"); return got; }
function half_slice(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).slice(1, 3); return got; }
function half_concat(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).concat([1.5]); return got; }
function half_reverse(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).reverse(); return got; }
function half_at(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).at(-1); return got; }
function half_push(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).push(0.5); return got; }
function half_pop(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).pop(); return got; }
function half_sort(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).sort(); return got; }
function half_fill(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x / 2).fill(0.25, 1, 2); return got; }
function nan_filter(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).filter(v => v === v); return got; }
function nan_reduce(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).reduce((t, v) => t + String(v) + " ", ""); return got; }
function nan_some(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).some(v => v !== v); return got; }
function nan_every(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).every(v => typeof v === "number"); return got; }
function nan_find(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).find(v => v > 3); return got; }
function nan_findIndex(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).findIndex(v => v > 3); return got; }
function nan_forEach(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).forEach(v => { seen += typeof v; }); return got; }
function nan_map(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).map(v => typeof v); return got; }
function nan_indexOfNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).indexOf(NaN); return got; }
function nan_includesNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).includes(NaN); return got; }
function nan_includesZero(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).includes(0); return got; }
function nan_join(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).join("|"); return got; }
function nan_slice(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).slice(1, 3); return got; }
function nan_concat(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).concat([1.5]); return got; }
function nan_reverse(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).reverse(); return got; }
function nan_at(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).at(-1); return got; }
function nan_push(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).push(0.5); return got; }
function nan_pop(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).pop(); return got; }
function nan_sort(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).sort(); return got; }
function nan_fill(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x % 2 ? NaN : x).fill(0.25, 1, 2); return got; }
function minusZero_filter(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).filter(v => v === v); return got; }
function minusZero_reduce(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).reduce((t, v) => t + String(v) + " ", ""); return got; }
function minusZero_some(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).some(v => v !== v); return got; }
function minusZero_every(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).every(v => typeof v === "number"); return got; }
function minusZero_find(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).find(v => v > 3); return got; }
function minusZero_findIndex(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).findIndex(v => v > 3); return got; }
function minusZero_forEach(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).forEach(v => { seen += typeof v; }); return got; }
function minusZero_map(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).map(v => typeof v); return got; }
function minusZero_indexOfNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).indexOf(NaN); return got; }
function minusZero_includesNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).includes(NaN); return got; }
function minusZero_includesZero(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).includes(0); return got; }
function minusZero_join(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).join("|"); return got; }
function minusZero_slice(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).slice(1, 3); return got; }
function minusZero_concat(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).concat([1.5]); return got; }
function minusZero_reverse(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).reverse(); return got; }
function minusZero_at(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).at(-1); return got; }
function minusZero_push(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).push(0.5); return got; }
function minusZero_pop(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).pop(); return got; }
function minusZero_sort(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).sort(); return got; }
function minusZero_fill(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => -0 * x).fill(0.25, 1, 2); return got; }
function mixed_filter(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).filter(v => v === v); return got; }
function mixed_reduce(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).reduce((t, v) => t + String(v) + " ", ""); return got; }
function mixed_some(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).some(v => v !== v); return got; }
function mixed_every(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).every(v => typeof v === "number"); return got; }
function mixed_find(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).find(v => v > 3); return got; }
function mixed_findIndex(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).findIndex(v => v > 3); return got; }
function mixed_forEach(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).forEach(v => { seen += typeof v; }); return got; }
function mixed_map(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).map(v => typeof v); return got; }
function mixed_indexOfNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).indexOf(NaN); return got; }
function mixed_includesNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).includes(NaN); return got; }
function mixed_includesZero(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).includes(0); return got; }
function mixed_join(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).join("|"); return got; }
function mixed_slice(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).slice(1, 3); return got; }
function mixed_concat(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).concat([1.5]); return got; }
function mixed_reverse(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).reverse(); return got; }
function mixed_at(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).at(-1); return got; }
function mixed_push(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).push(0.5); return got; }
function mixed_pop(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).pop(); return got; }
function mixed_sort(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).sort(); return got; }
function mixed_fill(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? "t" + x : x).fill(0.25, 1, 2); return got; }
function gaps_filter(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).filter(v => v === v); return got; }
function gaps_reduce(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).reduce((t, v) => t + String(v) + " ", ""); return got; }
function gaps_some(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).some(v => v !== v); return got; }
function gaps_every(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).every(v => typeof v === "number"); return got; }
function gaps_find(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).find(v => v > 3); return got; }
function gaps_findIndex(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).findIndex(v => v > 3); return got; }
function gaps_forEach(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).forEach(v => { seen += typeof v; }); return got; }
function gaps_map(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).map(v => typeof v); return got; }
function gaps_indexOfNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).indexOf(NaN); return got; }
function gaps_includesNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).includes(NaN); return got; }
function gaps_includesZero(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).includes(0); return got; }
function gaps_join(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).join("|"); return got; }
function gaps_slice(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).slice(1, 3); return got; }
function gaps_concat(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).concat([1.5]); return got; }
function gaps_reverse(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).reverse(); return got; }
function gaps_at(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).at(-1); return got; }
function gaps_push(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).push(0.5); return got; }
function gaps_pop(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).pop(); return got; }
function gaps_sort(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).sort(); return got; }
function gaps_fill(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x > 2 ? undefined : x * 0.5).fill(0.25, 1, 2); return got; }
function huge_filter(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).filter(v => v === v); return got; }
function huge_reduce(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).reduce((t, v) => t + String(v) + " ", ""); return got; }
function huge_some(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).some(v => v !== v); return got; }
function huge_every(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).every(v => typeof v === "number"); return got; }
function huge_find(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).find(v => v > 3); return got; }
function huge_findIndex(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).findIndex(v => v > 3); return got; }
function huge_forEach(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).forEach(v => { seen += typeof v; }); return got; }
function huge_map(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).map(v => typeof v); return got; }
function huge_indexOfNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).indexOf(NaN); return got; }
function huge_includesNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).includes(NaN); return got; }
function huge_includesZero(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).includes(0); return got; }
function huge_join(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).join("|"); return got; }
function huge_slice(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).slice(1, 3); return got; }
function huge_concat(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).concat([1.5]); return got; }
function huge_reverse(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).reverse(); return got; }
function huge_at(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).at(-1); return got; }
function huge_push(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).push(0.5); return got; }
function huge_pop(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).pop(); return got; }
function huge_sort(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).sort(); return got; }
function huge_fill(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1e300 * 1e10).fill(0.25, 1, 2); return got; }
function wide_filter(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).filter(v => v === v); return got; }
function wide_reduce(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).reduce((t, v) => t + String(v) + " ", ""); return got; }
function wide_some(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).some(v => v !== v); return got; }
function wide_every(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).every(v => typeof v === "number"); return got; }
function wide_find(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).find(v => v > 3); return got; }
function wide_findIndex(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).findIndex(v => v > 3); return got; }
function wide_forEach(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).forEach(v => { seen += typeof v; }); return got; }
function wide_map(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).map(v => typeof v); return got; }
function wide_indexOfNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).indexOf(NaN); return got; }
function wide_includesNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).includes(NaN); return got; }
function wide_includesZero(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).includes(0); return got; }
function wide_join(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).join("|"); return got; }
function wide_slice(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).slice(1, 3); return got; }
function wide_concat(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).concat([1.5]); return got; }
function wide_reverse(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).reverse(); return got; }
function wide_at(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).at(-1); return got; }
function wide_push(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).push(0.5); return got; }
function wide_pop(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).pop(); return got; }
function wide_sort(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).sort(); return got; }
function wide_fill(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => 2147483648 + x).fill(0.25, 1, 2); return got; }
function boxes_filter(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).filter(v => v === v); return got; }
function boxes_reduce(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).reduce((t, v) => t + String(v) + " ", ""); return got; }
function boxes_some(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).some(v => v !== v); return got; }
function boxes_every(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).every(v => typeof v === "number"); return got; }
function boxes_find(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).find(v => v > 3); return got; }
function boxes_findIndex(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).findIndex(v => v > 3); return got; }
function boxes_forEach(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).forEach(v => { seen += typeof v; }); return got; }
function boxes_map(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).map(v => typeof v); return got; }
function boxes_indexOfNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).indexOf(NaN); return got; }
function boxes_includesNaN(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).includes(NaN); return got; }
function boxes_includesZero(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).includes(0); return got; }
function boxes_join(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).join("|"); return got; }
function boxes_slice(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).slice(1, 3); return got; }
function boxes_concat(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).concat([1.5]); return got; }
function boxes_reverse(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).reverse(); return got; }
function boxes_at(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).at(-1); return got; }
function boxes_push(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).push(0.5); return got; }
function boxes_pop(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).pop(); return got; }
function boxes_sort(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).sort(); return got; }
function boxes_fill(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => ({ x })).fill(0.25, 1, 2); return got; }
const all = {twice_filter, twice_reduce, twice_some, twice_every, twice_find, twice_findIndex, twice_forEach, twice_map, twice_indexOfNaN, twice_includesNaN, twice_includesZero, twice_join, twice_slice, twice_concat, twice_reverse, twice_at, twice_push, twice_pop, twice_sort, twice_fill, half_filter, half_reduce, half_some, half_every, half_find, half_findIndex, half_forEach, half_map, half_indexOfNaN, half_includesNaN, half_includesZero, half_join, half_slice, half_concat, half_reverse, half_at, half_push, half_pop, half_sort, half_fill, nan_filter, nan_reduce, nan_some, nan_every, nan_find, nan_findIndex, nan_forEach, nan_map, nan_indexOfNaN, nan_includesNaN, nan_includesZero, nan_join, nan_slice, nan_concat, nan_reverse, nan_at, nan_push, nan_pop, nan_sort, nan_fill, minusZero_filter, minusZero_reduce, minusZero_some, minusZero_every, minusZero_find, minusZero_findIndex, minusZero_forEach, minusZero_map, minusZero_indexOfNaN, minusZero_includesNaN, minusZero_includesZero, minusZero_join, minusZero_slice, minusZero_concat, minusZero_reverse, minusZero_at, minusZero_push, minusZero_pop, minusZero_sort, minusZero_fill, mixed_filter, mixed_reduce, mixed_some, mixed_every, mixed_find, mixed_findIndex, mixed_forEach, mixed_map, mixed_indexOfNaN, mixed_includesNaN, mixed_includesZero, mixed_join, mixed_slice, mixed_concat, mixed_reverse, mixed_at, mixed_push, mixed_pop, mixed_sort, mixed_fill, gaps_filter, gaps_reduce, gaps_some, gaps_every, gaps_find, gaps_findIndex, gaps_forEach, gaps_map, gaps_indexOfNaN, gaps_includesNaN, gaps_includesZero, gaps_join, gaps_slice, gaps_concat, gaps_reverse, gaps_at, gaps_push, gaps_pop, gaps_sort, gaps_fill, huge_filter, huge_reduce, huge_some, huge_every, huge_find, huge_findIndex, huge_forEach, huge_map, huge_indexOfNaN, huge_includesNaN, huge_includesZero, huge_join, huge_slice, huge_concat, huge_reverse, huge_at, huge_push, huge_pop, huge_sort, huge_fill, wide_filter, wide_reduce, wide_some, wide_every, wide_find, wide_findIndex, wide_forEach, wide_map, wide_indexOfNaN, wide_includesNaN, wide_includesZero, wide_join, wide_slice, wide_concat, wide_reverse, wide_at, wide_push, wide_pop, wide_sort, wide_fill, boxes_filter, boxes_reduce, boxes_some, boxes_every, boxes_find, boxes_findIndex, boxes_forEach, boxes_map, boxes_indexOfNaN, boxes_includesNaN, boxes_includesZero, boxes_join, boxes_slice, boxes_concat, boxes_reverse, boxes_at, boxes_push, boxes_pop, boxes_sort, boxes_fill};
for (const name in all) console.log(name, sources.map(list => say(all[name](list))).join(" ; "));
console.log(seen.length);
// STATISTIC: ArraySpeciesLookupsElided >= 1
// STATISTIC: NumberStoresDispatchedByIndexingType <= 72
