// `list.length = 0` makes a list shorter and leaves no hole. Every other way to change the length may leave one. Each list is then read at every index below its length.
const lengthKey = JSON.parse('"length"');
function same(x) { return x; }
function clear(x) { x.length = 0; }
function grow(x) { x.length = 5; }
function lengthStore(value) { this.length = value; }
class List extends Array { clear() { super.length = 0; } grow() { super.length = 5; } }
const lines = [];
function read_cleared(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = 0; return read_cleared(x) + '|' + (y === undefined ? '' : read_cleared(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared(n); if (n < 3 || n === 399) lines.push('cleared ' + line); }
function read_cleared_then_pushed(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_then_pushed(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = 0; x.push(n, n + 1); return read_cleared_then_pushed(x) + '|' + (y === undefined ? '' : read_cleared_then_pushed(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_then_pushed(n); if (n < 3 || n === 399) lines.push('cleared_then_pushed ' + line); }
function read_cleared_then_stored_past_end(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_then_stored_past_end(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = 0; x[2] = n; return read_cleared_then_stored_past_end(x) + '|' + (y === undefined ? '' : read_cleared_then_stored_past_end(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_then_stored_past_end(n); if (n < 3 || n === 399) lines.push('cleared_then_stored_past_end ' + line); }
function read_cleared_then_stored_below_old_length(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_then_stored_below_old_length(n) { let x = [n, n + 1, n + 2, n + 3], y; const old = x.length; x.length = 0; for (let i = 1; i < old; i++) x[i] = n + i; return read_cleared_then_stored_below_old_length(x) + '|' + (y === undefined ? '' : read_cleared_then_stored_below_old_length(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_then_stored_below_old_length(n); if (n < 3 || n === 399) lines.push('cleared_then_stored_below_old_length ' + line); }
function read_stored_below_length_read_before_clearing(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_stored_below_length_read_before_clearing(n) { let x = [n, n + 1, n + 2, n + 3], y; const old = x.length; clear(x); if (1 < old) x[1] = n; return read_stored_below_length_read_before_clearing(x) + '|' + (y === undefined ? '' : read_stored_below_length_read_before_clearing(y)); }
for (let n = 1; n < 400; n++) { const line = case_stored_below_length_read_before_clearing(n); if (n < 3 || n === 399) lines.push('stored_below_length_read_before_clearing ' + line); }
function read_cleared_then_grown(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_then_grown(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = 0; x.length = 3; return read_cleared_then_grown(x) + '|' + (y === undefined ? '' : read_cleared_then_grown(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_then_grown(n); if (n < 3 || n === 399) lines.push('cleared_then_grown ' + line); }
function read_grown(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = 6; return read_grown(x) + '|' + (y === undefined ? '' : read_grown(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown(n); if (n < 3 || n === 399) lines.push('grown ' + line); }
function read_truncated(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_truncated(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = 2; return read_truncated(x) + '|' + (y === undefined ? '' : read_truncated(y)); }
for (let n = 1; n < 400; n++) { const line = case_truncated(n); if (n < 3 || n === 399) lines.push('truncated ' + line); }
function read_truncated_then_grown(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_truncated_then_grown(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = 1; x.length = 4; return read_truncated_then_grown(x) + '|' + (y === undefined ? '' : read_truncated_then_grown(y)); }
for (let n = 1; n < 400; n++) { const line = case_truncated_then_grown(n); if (n < 3 || n === 399) lines.push('truncated_then_grown ' + line); }
function read_cleared_by_variable(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_by_variable(n) { let x = [n, n + 1, n + 2, n + 3], y; const zero = n - n; x.length = zero; return read_cleared_by_variable(x) + '|' + (y === undefined ? '' : read_cleared_by_variable(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_by_variable(n); if (n < 3 || n === 399) lines.push('cleared_by_variable ' + line); }
function read_grown_by_variable(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_variable(n) { let x = [n, n + 1, n + 2, n + 3], y; const more = n - n + 7; x.length = more; return read_grown_by_variable(x) + '|' + (y === undefined ? '' : read_grown_by_variable(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_variable(n); if (n < 3 || n === 399) lines.push('grown_by_variable ' + line); }
function read_cleared_by_negative_zero(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_by_negative_zero(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = -0; x.push(n); return read_cleared_by_negative_zero(x) + '|' + (y === undefined ? '' : read_cleared_by_negative_zero(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_by_negative_zero(n); if (n < 3 || n === 399) lines.push('cleared_by_negative_zero ' + line); }
function read_cleared_by_false(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_by_false(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = false; x.push(n); return read_cleared_by_false(x) + '|' + (y === undefined ? '' : read_cleared_by_false(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_by_false(n); if (n < 3 || n === 399) lines.push('cleared_by_false ' + line); }
function read_cleared_by_text(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_by_text(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = '0'; x.push(n); return read_cleared_by_text(x) + '|' + (y === undefined ? '' : read_cleared_by_text(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_by_text(n); if (n < 3 || n === 399) lines.push('cleared_by_text ' + line); }
function read_grown_by_text(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_text(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = '5'; return read_grown_by_text(x) + '|' + (y === undefined ? '' : read_grown_by_text(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_text(n); if (n < 3 || n === 399) lines.push('grown_by_text ' + line); }
function read_cleared_by_bracket(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_by_bracket(n) { let x = [n, n + 1, n + 2, n + 3], y; x['length'] = 0; x.push(n); return read_cleared_by_bracket(x) + '|' + (y === undefined ? '' : read_cleared_by_bracket(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_by_bracket(n); if (n < 3 || n === 399) lines.push('cleared_by_bracket ' + line); }
function read_grown_by_bracket(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_bracket(n) { let x = [n, n + 1, n + 2, n + 3], y; x['length'] = 5; return read_grown_by_bracket(x) + '|' + (y === undefined ? '' : read_grown_by_bracket(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_bracket(n); if (n < 3 || n === 399) lines.push('grown_by_bracket ' + line); }
function read_grown_by_computed_key(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_computed_key(n) { let x = [n, n + 1, n + 2, n + 3], y; x[lengthKey] = 5; return read_grown_by_computed_key(x) + '|' + (y === undefined ? '' : read_grown_by_computed_key(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_computed_key(n); if (n < 3 || n === 399) lines.push('grown_by_computed_key ' + line); }
function read_cleared_by_computed_key(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_by_computed_key(n) { let x = [n, n + 1, n + 2, n + 3], y; x[lengthKey] = 0; x.push(n); return read_cleared_by_computed_key(x) + '|' + (y === undefined ? '' : read_cleared_by_computed_key(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_by_computed_key(n); if (n < 3 || n === 399) lines.push('cleared_by_computed_key ' + line); }
function read_grown_by_reflect_set(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_reflect_set(n) { let x = [n, n + 1, n + 2, n + 3], y; Reflect.set(x, 'length', 5); return read_grown_by_reflect_set(x) + '|' + (y === undefined ? '' : read_grown_by_reflect_set(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_reflect_set(n); if (n < 3 || n === 399) lines.push('grown_by_reflect_set ' + line); }
function read_cleared_by_reflect_set(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_by_reflect_set(n) { let x = [n, n + 1, n + 2, n + 3], y; Reflect.set(x, 'length', 0); x.push(n); return read_cleared_by_reflect_set(x) + '|' + (y === undefined ? '' : read_cleared_by_reflect_set(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_by_reflect_set(n); if (n < 3 || n === 399) lines.push('cleared_by_reflect_set ' + line); }
function read_grown_by_define_property(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_define_property(n) { let x = [n, n + 1, n + 2, n + 3], y; Object.defineProperty(x, 'length', { value: 5 }); return read_grown_by_define_property(x) + '|' + (y === undefined ? '' : read_grown_by_define_property(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_define_property(n); if (n < 3 || n === 399) lines.push('grown_by_define_property ' + line); }
function read_grown_by_assign(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_assign(n) { let x = [n, n + 1, n + 2, n + 3], y; Object.assign(x, { length: 5 }); return read_grown_by_assign(x) + '|' + (y === undefined ? '' : read_grown_by_assign(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_assign(n); if (n < 3 || n === 399) lines.push('grown_by_assign ' + line); }
function read_grown_by_destructuring(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_destructuring(n) { let x = [n, n + 1, n + 2, n + 3], y; [x.length] = [5]; return read_grown_by_destructuring(x) + '|' + (y === undefined ? '' : read_grown_by_destructuring(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_destructuring(n); if (n < 3 || n === 399) lines.push('grown_by_destructuring ' + line); }
function read_grown_by_object_pattern(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_object_pattern(n) { let x = [n, n + 1, n + 2, n + 3], y; ({ size: x.length } = { size: 5 }); return read_grown_by_object_pattern(x) + '|' + (y === undefined ? '' : read_grown_by_object_pattern(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_object_pattern(n); if (n < 3 || n === 399) lines.push('grown_by_object_pattern ' + line); }
function read_grown_by_compound(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_compound(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length += 2; return read_grown_by_compound(x) + '|' + (y === undefined ? '' : read_grown_by_compound(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_compound(n); if (n < 3 || n === 399) lines.push('grown_by_compound ' + line); }
function read_grown_by_increment(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_increment(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length++; return read_grown_by_increment(x) + '|' + (y === undefined ? '' : read_grown_by_increment(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_increment(n); if (n < 3 || n === 399) lines.push('grown_by_increment ' + line); }
function read_shrunk_by_decrement(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_shrunk_by_decrement(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length--; return read_shrunk_by_decrement(x) + '|' + (y === undefined ? '' : read_shrunk_by_decrement(y)); }
for (let n = 1; n < 400; n++) { const line = case_shrunk_by_decrement(n); if (n < 3 || n === 399) lines.push('shrunk_by_decrement ' + line); }
function read_grown_by_for_of_target(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_for_of_target(n) { let x = [n, n + 1, n + 2, n + 3], y; for (x.length of [5]); return read_grown_by_for_of_target(x) + '|' + (y === undefined ? '' : read_grown_by_for_of_target(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_for_of_target(n); if (n < 3 || n === 399) lines.push('grown_by_for_of_target ' + line); }
function read_grown_by_for_in_target(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_for_in_target(n) { let x = [n, n + 1, n + 2, n + 3], y; for (x.length in { 5: 1 }); return read_grown_by_for_in_target(x) + '|' + (y === undefined ? '' : read_grown_by_for_in_target(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_for_in_target(n); if (n < 3 || n === 399) lines.push('grown_by_for_in_target ' + line); }
function read_grown_by_logical_assignment(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_logical_assignment(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = 0; x.length ||= 4; return read_grown_by_logical_assignment(x) + '|' + (y === undefined ? '' : read_grown_by_logical_assignment(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_logical_assignment(n); if (n < 3 || n === 399) lines.push('grown_by_logical_assignment ' + line); }
function read_cleared_through_alias(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_through_alias(n) { let x = [n, n + 1, n + 2, n + 3], y; const alias = same(x); alias.length = 0; alias.push(n); return read_cleared_through_alias(x) + '|' + (y === undefined ? '' : read_cleared_through_alias(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_through_alias(n); if (n < 3 || n === 399) lines.push('cleared_through_alias ' + line); }
function read_grown_through_alias(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_through_alias(n) { let x = [n, n + 1, n + 2, n + 3], y; const alias = same(x); alias.length = 5; return read_grown_through_alias(x) + '|' + (y === undefined ? '' : read_grown_through_alias(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_through_alias(n); if (n < 3 || n === 399) lines.push('grown_through_alias ' + line); }
function read_cleared_in_callee(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_in_callee(n) { let x = [n, n + 1, n + 2, n + 3], y; clear(x); x.push(n); return read_cleared_in_callee(x) + '|' + (y === undefined ? '' : read_cleared_in_callee(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_in_callee(n); if (n < 3 || n === 399) lines.push('cleared_in_callee ' + line); }
function read_grown_in_callee(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_in_callee(n) { let x = [n, n + 1, n + 2, n + 3], y; grow(x); return read_grown_in_callee(x) + '|' + (y === undefined ? '' : read_grown_in_callee(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_in_callee(n); if (n < 3 || n === 399) lines.push('grown_in_callee ' + line); }
function read_either_cleared_or_grown(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_either_cleared_or_grown(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = n & 1 ? 0 : 6; return read_either_cleared_or_grown(x) + '|' + (y === undefined ? '' : read_either_cleared_or_grown(y)); }
for (let n = 1; n < 400; n++) { const line = case_either_cleared_or_grown(n); if (n < 3 || n === 399) lines.push('either_cleared_or_grown ' + line); }
function read_cleared_while_sliced(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_while_sliced(n) { let x = [n, n + 1, n + 2, n + 3], y; y = x.slice(0, { valueOf() { x.length = 0; return 4; } }); return read_cleared_while_sliced(x) + '|' + (y === undefined ? '' : read_cleared_while_sliced(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_while_sliced(n); if (n < 3 || n === 399) lines.push('cleared_while_sliced ' + line); }
function read_cleared_while_mapped(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_while_mapped(n) { let x = [n, n + 1, n + 2, n + 3], y; y = x.map((v, i) => { if (i === 1) x.length = 0; return v; }); return read_cleared_while_mapped(x) + '|' + (y === undefined ? '' : read_cleared_while_mapped(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_while_mapped(n); if (n < 3 || n === 399) lines.push('cleared_while_mapped ' + line); }
function read_cleared_while_concatenated(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_while_concatenated(n) { let x = [n, n + 1, n + 2, n + 3], y; y = x.concat({ get [Symbol.isConcatSpreadable]() { x.length = 0; return false; } }, x); return read_cleared_while_concatenated(x) + '|' + (y === undefined ? '' : read_cleared_while_concatenated(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_while_concatenated(n); if (n < 3 || n === 399) lines.push('cleared_while_concatenated ' + line); }
function read_cleared_while_spliced(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_while_spliced(n) { let x = [n, n + 1, n + 2, n + 3], y; y = x.splice(0, { valueOf() { x.length = 0; return 3; } }); return read_cleared_while_spliced(x) + '|' + (y === undefined ? '' : read_cleared_while_spliced(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_while_spliced(n); if (n < 3 || n === 399) lines.push('cleared_while_spliced ' + line); }
function read_cleared_while_filled(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_while_filled(n) { let x = [n, n + 1, n + 2, n + 3], y; x.fill(n, 0, { valueOf() { x.length = 0; return 3; } }); return read_cleared_while_filled(x) + '|' + (y === undefined ? '' : read_cleared_while_filled(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_while_filled(n); if (n < 3 || n === 399) lines.push('cleared_while_filled ' + line); }
function read_cleared_while_iterated(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_while_iterated(n) { let x = [n, n + 1, n + 2, n + 3], y; y = []; for (const v of x) { y.push(v); if (y.length === 2) x.length = 0; } return read_cleared_while_iterated(x) + '|' + (y === undefined ? '' : read_cleared_while_iterated(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_while_iterated(n); if (n < 3 || n === 399) lines.push('cleared_while_iterated ' + line); }
function read_cleared_while_spread(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_while_spread(n) { let x = [n, n + 1, n + 2, n + 3], y; y = [...x, ...(x.length = 0, x), n]; return read_cleared_while_spread(x) + '|' + (y === undefined ? '' : read_cleared_while_spread(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_while_spread(n); if (n < 3 || n === 399) lines.push('cleared_while_spread ' + line); }
function read_cleared_frozen(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_frozen(n) { let x = [n, n + 1, n + 2, n + 3], y; Object.freeze(x); try { x.length = 0; } catch (error) { y = [error.constructor.name]; } return read_cleared_frozen(x) + '|' + (y === undefined ? '' : read_cleared_frozen(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_frozen(n); if (n < 3 || n === 399) lines.push('cleared_frozen ' + line); }
function read_cleared_with_fixed_length(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_with_fixed_length(n) { let x = [n, n + 1, n + 2, n + 3], y; Object.defineProperty(x, 'length', { writable: false }); try { x.length = 0; } catch (error) { y = [error.constructor.name]; } return read_cleared_with_fixed_length(x) + '|' + (y === undefined ? '' : read_cleared_with_fixed_length(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_with_fixed_length(n); if (n < 3 || n === 399) lines.push('cleared_with_fixed_length ' + line); }
function read_cleared_then_unshifted(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_then_unshifted(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = 0; x.unshift(n, n); return read_cleared_then_unshifted(x) + '|' + (y === undefined ? '' : read_cleared_then_unshifted(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_then_unshifted(n); if (n < 3 || n === 399) lines.push('cleared_then_unshifted ' + line); }
function read_cleared_then_holds_doubles(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_then_holds_doubles(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = 0; x.push(n + 0.5, n); return read_cleared_then_holds_doubles(x) + '|' + (y === undefined ? '' : read_cleared_then_holds_doubles(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_then_holds_doubles(n); if (n < 3 || n === 399) lines.push('cleared_then_holds_doubles ' + line); }
function read_cleared_then_holds_text(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_then_holds_text(n) { let x = [n, n + 1, n + 2, n + 3], y; x.length = 0; x.push('t', n); return read_cleared_then_holds_text(x) + '|' + (y === undefined ? '' : read_cleared_then_holds_text(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_then_holds_text(n); if (n < 3 || n === 399) lines.push('cleared_then_holds_text ' + line); }
function read_cleared_of_subclass(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_of_subclass(n) { let x = [n, n + 1, n + 2, n + 3], y; x = new List(n, n, n); x.length = 0; x.push(n); return read_cleared_of_subclass(x) + '|' + (y === undefined ? '' : read_cleared_of_subclass(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_of_subclass(n); if (n < 3 || n === 399) lines.push('cleared_of_subclass ' + line); }
function read_cleared_by_super(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_cleared_by_super(n) { let x = [n, n + 1, n + 2, n + 3], y; x = new List(n, n, n); x.clear(); x.push(n); return read_cleared_by_super(x) + '|' + (y === undefined ? '' : read_cleared_by_super(y)); }
for (let n = 1; n < 400; n++) { const line = case_cleared_by_super(n); if (n < 3 || n === 399) lines.push('cleared_by_super ' + line); }
function read_grown_by_super(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_super(n) { let x = [n, n + 1, n + 2, n + 3], y; x = new List(n, n, n); x.grow(); return read_grown_by_super(x) + '|' + (y === undefined ? '' : read_grown_by_super(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_super(n); if (n < 3 || n === 399) lines.push('grown_by_super ' + line); }
function read_grown_by_setter_taken_off(a) { let text = '', sum = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; text += (i in a ? '' : 'hole:') + String(v) + ','; if (typeof v === 'number') sum += v; } return text + sum; }
function case_grown_by_setter_taken_off(n) { let x = [n, n + 1, n + 2, n + 3], y; lengthStore.call(x, 5); return read_grown_by_setter_taken_off(x) + '|' + (y === undefined ? '' : read_grown_by_setter_taken_off(y)); }
for (let n = 1; n < 400; n++) { const line = case_grown_by_setter_taken_off(n); if (n < 3 || n === 399) lines.push('grown_by_setter_taken_off ' + line); }
console.log(lines.join('\n'));
