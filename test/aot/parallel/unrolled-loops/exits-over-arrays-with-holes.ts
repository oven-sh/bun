// Loops that end at their bound or by a break, a return or a throw in every place, and what is read behind them.
let steps = 0, total = 0;
function make(n: number, p: number): number[] { const a: number[] = new Array(n); for (let k = 0; k < n; k++) if (k % 5 !== 3 || k === p) a[k] = k === p ? -7 : k + 1; return a; }
function work_counter(a: number[], q: number): string | number { let i = 0; while (i < a.length && a[i]! !== -7) i++; return i; }
function work_for_break(a: number[], q: number): string | number { let i = 0; for (; i < a.length; i++) if (a[i]! === -7) break; return i * 2 + 1; }
function work_return(a: number[], q: number): string | number { for (let i = 0; i < a.length; i++) if (a[i]! === -7) return i; return -1; }
function work_return_sum(a: number[], q: number): string | number { let s = 0; for (let i = 0; i < a.length; i++) { if (a[i]! === -7) return s + i; s += a[i]!; } return -s; }
function work_sum(a: number[], q: number): string | number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; return s; }
function work_sum_break(a: number[], q: number): string | number { let s = 0, i = 0; for (; i < a.length; i++) { if (a[i]! === -7) break; s += a[i]!; } return s + "/" + i; }
function work_found(a: number[], q: number): string | number { let found = -1, s = 0; for (let i = 0; i < a.length; i++) { if (a[i]! === -7) { found = i; break; } s = (s * 31 + i) | 0; } return found + "/" + s; }
function work_two_breaks(a: number[], q: number): string | number { let i = 0, why = 0; for (; i < a.length; i++) { if (a[i]! === -7) { why = 1; break; } if (i === q) { why = 2; break; } } return why + "/" + i; }
function work_two_ends(a: number[], q: number): string | number { let i = 0; for (; i < a.length; i++) { if (a[i]! === -7) return "m" + i; if (i > q) break; } return "e" + i; }
function work_down(a: number[], q: number): string | number { let i = a.length - 1; while (i >= 0 && a[i]! !== -7) i--; return i; }
function work_down_le(a: number[], q: number): string | number { let i = a.length; for (; i > 0; i--) if (a[i - 1]! === -7) break; return i; }
function work_last_seen(a: number[], q: number): string | number { let last = 0, i = 0; for (; i < a.length; i++) { const x = a[i]!; if (x === -7) break; last = x; } return last + "/" + i; }
function work_max(a: number[], q: number): string | number { let m = -1000, where = 0; for (let i = 0; i < a.length; i++) if (a[i]! > m) { m = a[i]!; where = i; } return m + "/" + where; }
function work_element(a: number[], q: number): string | number { let i = 0; for (; i < a.length; i++) { const x = a[i]!; if (x === -7) return x + i; } return i; }
function work_nested(a: number[], q: number): string | number { let s = 0; for (let j = 0; j < 3; j++) { let i = j; while (i < a.length && a[i]! !== -7) i++; s = s * 100 + i; } return s; }
function work_labelled(a: number[], q: number): string | number { let s = 0; outer: for (let j = 0; j < 4; j++) { for (let i = 0; i < a.length; i++) { if (a[i]! === -7 && j > 1) break outer; s += i; } s += 1000; } return s; }
function work_continue_outer(a: number[], q: number): string | number { let s = 0; outer: for (let j = 0; j < 4; j++) { for (let i = 0; i < a.length; i++) { if (a[i]! === -7) continue outer; s += i; } s += 1000; } return s; }
function work_step_two(a: number[], q: number): string | number { let i = 0; for (; i < a.length; i += 2) if (a[i]! === -7) break; return i; }
function work_limit(a: number[], q: number): string | number { let i = 0; const end = Math.min(a.length, q + 3); while (i < end && a[i]! !== -7) i++; return i; }
function work_or(a: number[], q: number): string | number { let i = 0; while (i < a.length) { if (a[i]! === -7 || i === q) return "x" + i; i++; } return "y" + i; }
function work_two_loops(a: number[], q: number): string | number { let i = 0; while (i < a.length && a[i]! !== -7) i++; const first = i; while (i < a.length && a[i]! === -7) i++; return first + "/" + i; }
function work_in_try(a: number[], q: number): string | number { let i = 0, s = 0; try { for (; i < a.length; i++) { if (a[i]! === -7) break; s += i; } if (i === q) throw new Error("q"); } catch { s += 5000; } return s + "/" + i; }
function work_count(a: number[], q: number): string | number { let c = 0; for (let i = 0; i < a.length; i++) if (a[i]! === -7) c++; return c; }
function work_three(a: number[], q: number): string | number { let i = 0, x = 0, y = 1; for (; i < a.length; i++) { if (a[i]! === -7) break; const t = x + y; x = y; y = t & 1023; } return i + "/" + x + "/" + y; }
function work_double_sum(a: number[], q: number): string | number { let s = 0.5; let i = 0; for (; i < a.length; i++) { if (a[i]! === -7) break; s += a[i]! * 0.5; } return s + "/" + i; }
function work_object_after(a: number[], q: number): string | number { let i = 0, s = 0; for (; i < a.length; i++) { if (a[i]! === -7) break; s += 2; } const o = { i, s, t: [i, s] }; return JSON.stringify(o); }
function work_closure_after(a: number[], q: number): string | number { let i = 0, s = 0; for (; i < a.length; i++) { if (a[i]! === -7) break; s += 2; } const f = () => i + s; return f(); }
function work_module_counter(a: number[], q: number): string | number { steps = 0; let i = 0; for (; i < a.length; i++) { if (a[i]! === -7) break; steps++; } return steps + "/" + i; }
function work_module_sum(a: number[], q: number): string | number { total = 0; for (let i = 0; i < a.length; i++) total += i; let i = 0; while (i < a.length && a[i]! !== -7) { total += 3; i++; } return total; }
function work_swap_values(a: number[], q: number): string | number { let x = 1, y = 2; let i = 0; for (; i < a.length; i++) { if (a[i]! === -7) break; const t = x; x = y; y = t; } return x * 10 + y + "/" + i; }
function work_if_inside(a: number[], q: number): string | number { let s = 0, i = 0; for (; i < a.length; i++) { const x = a[i]!; if (x === -7) break; if (x > 5) s += 1; else s += 2; } return s + "/" + i; }
function work_store_view(a: number[], q: number): string | number { const out = new Int32Array(24); let i = 0; for (; i < a.length; i++) { if (a[i]! === -7) break; out[i] = i * 3; } return i + "/" + out.join(); }
function work_store_list(a: number[], q: number): string | number { const out: number[] = new Array(24).fill(0); let i = 0; for (; i < a.length; i++) { if (a[i]! === -7) break; out[i] = i * 3; } return i + "/" + out.join(); }
function work_loop_after(a: number[], q: number): string | number { let i = 0; while (i < a.length && a[i]! !== -7) i++; let s = 0; for (let k = i; k < a.length; k++) s += k; return i + "/" + s; }
function work_number_keys(a: number[], q: number): string | number { let i = 0; const x: any = q > 3 ? -7 : undefined; for (; i < a.length; i++) if (a[i]! === x) break; return i; }
const lines: string[] = [];
for (const n of [0, 1, 2, 3, 7, 8, 9, 15, 16, 17, 20]) for (let p = -1; p < n; p++) {
  const a = make(n, p);
  for (const q of [0, 2, 7, 11]) {
    lines.push("work_counter " + n + " " + p + " " + q + " " + work_counter(a, q) + " " + steps + " " + total);
    lines.push("work_for_break " + n + " " + p + " " + q + " " + work_for_break(a, q) + " " + steps + " " + total);
    lines.push("work_return " + n + " " + p + " " + q + " " + work_return(a, q) + " " + steps + " " + total);
    lines.push("work_return_sum " + n + " " + p + " " + q + " " + work_return_sum(a, q) + " " + steps + " " + total);
    lines.push("work_sum " + n + " " + p + " " + q + " " + work_sum(a, q) + " " + steps + " " + total);
    lines.push("work_sum_break " + n + " " + p + " " + q + " " + work_sum_break(a, q) + " " + steps + " " + total);
    lines.push("work_found " + n + " " + p + " " + q + " " + work_found(a, q) + " " + steps + " " + total);
    lines.push("work_two_breaks " + n + " " + p + " " + q + " " + work_two_breaks(a, q) + " " + steps + " " + total);
    lines.push("work_two_ends " + n + " " + p + " " + q + " " + work_two_ends(a, q) + " " + steps + " " + total);
    lines.push("work_down " + n + " " + p + " " + q + " " + work_down(a, q) + " " + steps + " " + total);
    lines.push("work_down_le " + n + " " + p + " " + q + " " + work_down_le(a, q) + " " + steps + " " + total);
    lines.push("work_last_seen " + n + " " + p + " " + q + " " + work_last_seen(a, q) + " " + steps + " " + total);
    lines.push("work_max " + n + " " + p + " " + q + " " + work_max(a, q) + " " + steps + " " + total);
    lines.push("work_element " + n + " " + p + " " + q + " " + work_element(a, q) + " " + steps + " " + total);
    lines.push("work_nested " + n + " " + p + " " + q + " " + work_nested(a, q) + " " + steps + " " + total);
    lines.push("work_labelled " + n + " " + p + " " + q + " " + work_labelled(a, q) + " " + steps + " " + total);
    lines.push("work_continue_outer " + n + " " + p + " " + q + " " + work_continue_outer(a, q) + " " + steps + " " + total);
    lines.push("work_step_two " + n + " " + p + " " + q + " " + work_step_two(a, q) + " " + steps + " " + total);
    lines.push("work_limit " + n + " " + p + " " + q + " " + work_limit(a, q) + " " + steps + " " + total);
    lines.push("work_or " + n + " " + p + " " + q + " " + work_or(a, q) + " " + steps + " " + total);
    lines.push("work_two_loops " + n + " " + p + " " + q + " " + work_two_loops(a, q) + " " + steps + " " + total);
    lines.push("work_in_try " + n + " " + p + " " + q + " " + work_in_try(a, q) + " " + steps + " " + total);
    lines.push("work_count " + n + " " + p + " " + q + " " + work_count(a, q) + " " + steps + " " + total);
    lines.push("work_three " + n + " " + p + " " + q + " " + work_three(a, q) + " " + steps + " " + total);
    lines.push("work_double_sum " + n + " " + p + " " + q + " " + work_double_sum(a, q) + " " + steps + " " + total);
    lines.push("work_object_after " + n + " " + p + " " + q + " " + work_object_after(a, q) + " " + steps + " " + total);
    lines.push("work_closure_after " + n + " " + p + " " + q + " " + work_closure_after(a, q) + " " + steps + " " + total);
    lines.push("work_module_counter " + n + " " + p + " " + q + " " + work_module_counter(a, q) + " " + steps + " " + total);
    lines.push("work_module_sum " + n + " " + p + " " + q + " " + work_module_sum(a, q) + " " + steps + " " + total);
    lines.push("work_swap_values " + n + " " + p + " " + q + " " + work_swap_values(a, q) + " " + steps + " " + total);
    lines.push("work_if_inside " + n + " " + p + " " + q + " " + work_if_inside(a, q) + " " + steps + " " + total);
    lines.push("work_store_view " + n + " " + p + " " + q + " " + work_store_view(a, q) + " " + steps + " " + total);
    lines.push("work_store_list " + n + " " + p + " " + q + " " + work_store_list(a, q) + " " + steps + " " + total);
    lines.push("work_loop_after " + n + " " + p + " " + q + " " + work_loop_after(a, q) + " " + steps + " " + total);
    lines.push("work_number_keys " + n + " " + p + " " + q + " " + work_number_keys(a, q) + " " + steps + " " + total);
  }
}
let hash = 0;
for (const line of lines) for (let k = 0; k < line.length; k++) hash = (hash * 31 + line.charCodeAt(k)) | 0;
console.log(lines.length, hash);
for (let k = 0; k < lines.length; k += 1009) console.log(lines[k]);
