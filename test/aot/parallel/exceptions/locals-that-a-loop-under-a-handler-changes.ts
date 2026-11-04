// What a handler finds in a local that a loop under it changes: every kind of loop, under catch, finally and both,
// a counter, a sum and a text that grows, read in the handler, behind it and in both, with a throw in each turn in its turn.
const log: string[] = [];
let failsAt = -1;
let calls = 0;
function say(s: string): void { if (calls++ === failsAt) throw new Error("at " + failsAt); log.push(s); }
const list = [1, 2, 3];
function doWhile_counter_catch_inside(): string { let n = 0; try { let i = 0; do { say("a"); n++; say("b"); } while (++i < 3); } catch (e) { log.push("seen " + n); } return "end"; }
function doWhile_counter_catch_behind(): string { let n = 0; try { let i = 0; do { say("a"); n++; say("b"); } while (++i < 3); } catch (e) { log.push("seen"); } return "end " + n; }
function doWhile_counter_catch_everywhere(): string { let n = 0; try { let i = 0; do { say("a"); n++; say("b"); } while (++i < 3); } catch (e) { log.push("seen " + n); } return "end " + n; }
function doWhile_counter_finally_inside(): string { let n = 0; try { try { let i = 0; do { say("a"); n++; say("b"); } while (++i < 3); } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function doWhile_counter_finally_behind(): string { let n = 0; try { try { let i = 0; do { say("a"); n++; say("b"); } while (++i < 3); } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function doWhile_counter_finally_everywhere(): string { let n = 0; try { try { let i = 0; do { say("a"); n++; say("b"); } while (++i < 3); } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function doWhile_counter_both_inside(): string { let n = 0; try { let i = 0; do { say("a"); n++; say("b"); } while (++i < 3); } catch (e) { log.push("seen " + n); n++; } finally { log.push("seen " + n); } return "end"; }
function doWhile_counter_both_behind(): string { let n = 0; try { let i = 0; do { say("a"); n++; say("b"); } while (++i < 3); } catch (e) { log.push("seen"); n++; } finally { log.push("seen"); } return "end " + n; }
function doWhile_counter_both_everywhere(): string { let n = 0; try { let i = 0; do { say("a"); n++; say("b"); } while (++i < 3); } catch (e) { log.push("seen " + n); n++; } finally { log.push("seen " + n); } return "end " + n; }
function doWhile_sum_catch_inside(): string { let n = 0.5; try { let i = 0; do { say("a"); n += 1.25; say("b"); } while (++i < 3); } catch (e) { log.push("seen " + n); } return "end"; }
function doWhile_sum_catch_behind(): string { let n = 0.5; try { let i = 0; do { say("a"); n += 1.25; say("b"); } while (++i < 3); } catch (e) { log.push("seen"); } return "end " + n; }
function doWhile_sum_catch_everywhere(): string { let n = 0.5; try { let i = 0; do { say("a"); n += 1.25; say("b"); } while (++i < 3); } catch (e) { log.push("seen " + n); } return "end " + n; }
function doWhile_sum_finally_inside(): string { let n = 0.5; try { try { let i = 0; do { say("a"); n += 1.25; say("b"); } while (++i < 3); } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function doWhile_sum_finally_behind(): string { let n = 0.5; try { try { let i = 0; do { say("a"); n += 1.25; say("b"); } while (++i < 3); } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function doWhile_sum_finally_everywhere(): string { let n = 0.5; try { try { let i = 0; do { say("a"); n += 1.25; say("b"); } while (++i < 3); } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function doWhile_sum_both_inside(): string { let n = 0.5; try { let i = 0; do { say("a"); n += 1.25; say("b"); } while (++i < 3); } catch (e) { log.push("seen " + n); n += 1.25; } finally { log.push("seen " + n); } return "end"; }
function doWhile_sum_both_behind(): string { let n = 0.5; try { let i = 0; do { say("a"); n += 1.25; say("b"); } while (++i < 3); } catch (e) { log.push("seen"); n += 1.25; } finally { log.push("seen"); } return "end " + n; }
function doWhile_sum_both_everywhere(): string { let n = 0.5; try { let i = 0; do { say("a"); n += 1.25; say("b"); } while (++i < 3); } catch (e) { log.push("seen " + n); n += 1.25; } finally { log.push("seen " + n); } return "end " + n; }
function doWhile_text_catch_inside(): string { let n = ""; try { let i = 0; do { say("a"); n += "x"; say("b"); } while (++i < 3); } catch (e) { log.push("seen " + n); } return "end"; }
function doWhile_text_catch_behind(): string { let n = ""; try { let i = 0; do { say("a"); n += "x"; say("b"); } while (++i < 3); } catch (e) { log.push("seen"); } return "end " + n; }
function doWhile_text_catch_everywhere(): string { let n = ""; try { let i = 0; do { say("a"); n += "x"; say("b"); } while (++i < 3); } catch (e) { log.push("seen " + n); } return "end " + n; }
function doWhile_text_finally_inside(): string { let n = ""; try { try { let i = 0; do { say("a"); n += "x"; say("b"); } while (++i < 3); } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function doWhile_text_finally_behind(): string { let n = ""; try { try { let i = 0; do { say("a"); n += "x"; say("b"); } while (++i < 3); } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function doWhile_text_finally_everywhere(): string { let n = ""; try { try { let i = 0; do { say("a"); n += "x"; say("b"); } while (++i < 3); } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function doWhile_text_both_inside(): string { let n = ""; try { let i = 0; do { say("a"); n += "x"; say("b"); } while (++i < 3); } catch (e) { log.push("seen " + n); n += "x"; } finally { log.push("seen " + n); } return "end"; }
function doWhile_text_both_behind(): string { let n = ""; try { let i = 0; do { say("a"); n += "x"; say("b"); } while (++i < 3); } catch (e) { log.push("seen"); n += "x"; } finally { log.push("seen"); } return "end " + n; }
function doWhile_text_both_everywhere(): string { let n = ""; try { let i = 0; do { say("a"); n += "x"; say("b"); } while (++i < 3); } catch (e) { log.push("seen " + n); n += "x"; } finally { log.push("seen " + n); } return "end " + n; }
function while_counter_catch_inside(): string { let n = 0; try { let i = 0; while (i++ < 3) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); } return "end"; }
function while_counter_catch_behind(): string { let n = 0; try { let i = 0; while (i++ < 3) { say("a"); n++; say("b"); } } catch (e) { log.push("seen"); } return "end " + n; }
function while_counter_catch_everywhere(): string { let n = 0; try { let i = 0; while (i++ < 3) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); } return "end " + n; }
function while_counter_finally_inside(): string { let n = 0; try { try { let i = 0; while (i++ < 3) { say("a"); n++; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function while_counter_finally_behind(): string { let n = 0; try { try { let i = 0; while (i++ < 3) { say("a"); n++; say("b"); } } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function while_counter_finally_everywhere(): string { let n = 0; try { try { let i = 0; while (i++ < 3) { say("a"); n++; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function while_counter_both_inside(): string { let n = 0; try { let i = 0; while (i++ < 3) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); n++; } finally { log.push("seen " + n); } return "end"; }
function while_counter_both_behind(): string { let n = 0; try { let i = 0; while (i++ < 3) { say("a"); n++; say("b"); } } catch (e) { log.push("seen"); n++; } finally { log.push("seen"); } return "end " + n; }
function while_counter_both_everywhere(): string { let n = 0; try { let i = 0; while (i++ < 3) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); n++; } finally { log.push("seen " + n); } return "end " + n; }
function while_sum_catch_inside(): string { let n = 0.5; try { let i = 0; while (i++ < 3) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); } return "end"; }
function while_sum_catch_behind(): string { let n = 0.5; try { let i = 0; while (i++ < 3) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen"); } return "end " + n; }
function while_sum_catch_everywhere(): string { let n = 0.5; try { let i = 0; while (i++ < 3) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); } return "end " + n; }
function while_sum_finally_inside(): string { let n = 0.5; try { try { let i = 0; while (i++ < 3) { say("a"); n += 1.25; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function while_sum_finally_behind(): string { let n = 0.5; try { try { let i = 0; while (i++ < 3) { say("a"); n += 1.25; say("b"); } } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function while_sum_finally_everywhere(): string { let n = 0.5; try { try { let i = 0; while (i++ < 3) { say("a"); n += 1.25; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function while_sum_both_inside(): string { let n = 0.5; try { let i = 0; while (i++ < 3) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); n += 1.25; } finally { log.push("seen " + n); } return "end"; }
function while_sum_both_behind(): string { let n = 0.5; try { let i = 0; while (i++ < 3) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen"); n += 1.25; } finally { log.push("seen"); } return "end " + n; }
function while_sum_both_everywhere(): string { let n = 0.5; try { let i = 0; while (i++ < 3) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); n += 1.25; } finally { log.push("seen " + n); } return "end " + n; }
function while_text_catch_inside(): string { let n = ""; try { let i = 0; while (i++ < 3) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); } return "end"; }
function while_text_catch_behind(): string { let n = ""; try { let i = 0; while (i++ < 3) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen"); } return "end " + n; }
function while_text_catch_everywhere(): string { let n = ""; try { let i = 0; while (i++ < 3) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); } return "end " + n; }
function while_text_finally_inside(): string { let n = ""; try { try { let i = 0; while (i++ < 3) { say("a"); n += "x"; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function while_text_finally_behind(): string { let n = ""; try { try { let i = 0; while (i++ < 3) { say("a"); n += "x"; say("b"); } } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function while_text_finally_everywhere(): string { let n = ""; try { try { let i = 0; while (i++ < 3) { say("a"); n += "x"; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function while_text_both_inside(): string { let n = ""; try { let i = 0; while (i++ < 3) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); n += "x"; } finally { log.push("seen " + n); } return "end"; }
function while_text_both_behind(): string { let n = ""; try { let i = 0; while (i++ < 3) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen"); n += "x"; } finally { log.push("seen"); } return "end " + n; }
function while_text_both_everywhere(): string { let n = ""; try { let i = 0; while (i++ < 3) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); n += "x"; } finally { log.push("seen " + n); } return "end " + n; }
function for_counter_catch_inside(): string { let n = 0; try { for (let i = 0; i < 3; i++) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); } return "end"; }
function for_counter_catch_behind(): string { let n = 0; try { for (let i = 0; i < 3; i++) { say("a"); n++; say("b"); } } catch (e) { log.push("seen"); } return "end " + n; }
function for_counter_catch_everywhere(): string { let n = 0; try { for (let i = 0; i < 3; i++) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); } return "end " + n; }
function for_counter_finally_inside(): string { let n = 0; try { try { for (let i = 0; i < 3; i++) { say("a"); n++; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function for_counter_finally_behind(): string { let n = 0; try { try { for (let i = 0; i < 3; i++) { say("a"); n++; say("b"); } } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function for_counter_finally_everywhere(): string { let n = 0; try { try { for (let i = 0; i < 3; i++) { say("a"); n++; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function for_counter_both_inside(): string { let n = 0; try { for (let i = 0; i < 3; i++) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); n++; } finally { log.push("seen " + n); } return "end"; }
function for_counter_both_behind(): string { let n = 0; try { for (let i = 0; i < 3; i++) { say("a"); n++; say("b"); } } catch (e) { log.push("seen"); n++; } finally { log.push("seen"); } return "end " + n; }
function for_counter_both_everywhere(): string { let n = 0; try { for (let i = 0; i < 3; i++) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); n++; } finally { log.push("seen " + n); } return "end " + n; }
function for_sum_catch_inside(): string { let n = 0.5; try { for (let i = 0; i < 3; i++) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); } return "end"; }
function for_sum_catch_behind(): string { let n = 0.5; try { for (let i = 0; i < 3; i++) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen"); } return "end " + n; }
function for_sum_catch_everywhere(): string { let n = 0.5; try { for (let i = 0; i < 3; i++) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); } return "end " + n; }
function for_sum_finally_inside(): string { let n = 0.5; try { try { for (let i = 0; i < 3; i++) { say("a"); n += 1.25; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function for_sum_finally_behind(): string { let n = 0.5; try { try { for (let i = 0; i < 3; i++) { say("a"); n += 1.25; say("b"); } } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function for_sum_finally_everywhere(): string { let n = 0.5; try { try { for (let i = 0; i < 3; i++) { say("a"); n += 1.25; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function for_sum_both_inside(): string { let n = 0.5; try { for (let i = 0; i < 3; i++) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); n += 1.25; } finally { log.push("seen " + n); } return "end"; }
function for_sum_both_behind(): string { let n = 0.5; try { for (let i = 0; i < 3; i++) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen"); n += 1.25; } finally { log.push("seen"); } return "end " + n; }
function for_sum_both_everywhere(): string { let n = 0.5; try { for (let i = 0; i < 3; i++) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); n += 1.25; } finally { log.push("seen " + n); } return "end " + n; }
function for_text_catch_inside(): string { let n = ""; try { for (let i = 0; i < 3; i++) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); } return "end"; }
function for_text_catch_behind(): string { let n = ""; try { for (let i = 0; i < 3; i++) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen"); } return "end " + n; }
function for_text_catch_everywhere(): string { let n = ""; try { for (let i = 0; i < 3; i++) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); } return "end " + n; }
function for_text_finally_inside(): string { let n = ""; try { try { for (let i = 0; i < 3; i++) { say("a"); n += "x"; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function for_text_finally_behind(): string { let n = ""; try { try { for (let i = 0; i < 3; i++) { say("a"); n += "x"; say("b"); } } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function for_text_finally_everywhere(): string { let n = ""; try { try { for (let i = 0; i < 3; i++) { say("a"); n += "x"; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function for_text_both_inside(): string { let n = ""; try { for (let i = 0; i < 3; i++) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); n += "x"; } finally { log.push("seen " + n); } return "end"; }
function for_text_both_behind(): string { let n = ""; try { for (let i = 0; i < 3; i++) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen"); n += "x"; } finally { log.push("seen"); } return "end " + n; }
function for_text_both_everywhere(): string { let n = ""; try { for (let i = 0; i < 3; i++) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); n += "x"; } finally { log.push("seen " + n); } return "end " + n; }
function forOf_counter_catch_inside(): string { let n = 0; try { for (const i of list) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); } return "end"; }
function forOf_counter_catch_behind(): string { let n = 0; try { for (const i of list) { say("a"); n++; say("b"); } } catch (e) { log.push("seen"); } return "end " + n; }
function forOf_counter_catch_everywhere(): string { let n = 0; try { for (const i of list) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); } return "end " + n; }
function forOf_counter_finally_inside(): string { let n = 0; try { try { for (const i of list) { say("a"); n++; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function forOf_counter_finally_behind(): string { let n = 0; try { try { for (const i of list) { say("a"); n++; say("b"); } } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function forOf_counter_finally_everywhere(): string { let n = 0; try { try { for (const i of list) { say("a"); n++; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function forOf_counter_both_inside(): string { let n = 0; try { for (const i of list) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); n++; } finally { log.push("seen " + n); } return "end"; }
function forOf_counter_both_behind(): string { let n = 0; try { for (const i of list) { say("a"); n++; say("b"); } } catch (e) { log.push("seen"); n++; } finally { log.push("seen"); } return "end " + n; }
function forOf_counter_both_everywhere(): string { let n = 0; try { for (const i of list) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); n++; } finally { log.push("seen " + n); } return "end " + n; }
function forOf_sum_catch_inside(): string { let n = 0.5; try { for (const i of list) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); } return "end"; }
function forOf_sum_catch_behind(): string { let n = 0.5; try { for (const i of list) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen"); } return "end " + n; }
function forOf_sum_catch_everywhere(): string { let n = 0.5; try { for (const i of list) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); } return "end " + n; }
function forOf_sum_finally_inside(): string { let n = 0.5; try { try { for (const i of list) { say("a"); n += 1.25; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function forOf_sum_finally_behind(): string { let n = 0.5; try { try { for (const i of list) { say("a"); n += 1.25; say("b"); } } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function forOf_sum_finally_everywhere(): string { let n = 0.5; try { try { for (const i of list) { say("a"); n += 1.25; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function forOf_sum_both_inside(): string { let n = 0.5; try { for (const i of list) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); n += 1.25; } finally { log.push("seen " + n); } return "end"; }
function forOf_sum_both_behind(): string { let n = 0.5; try { for (const i of list) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen"); n += 1.25; } finally { log.push("seen"); } return "end " + n; }
function forOf_sum_both_everywhere(): string { let n = 0.5; try { for (const i of list) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); n += 1.25; } finally { log.push("seen " + n); } return "end " + n; }
function forOf_text_catch_inside(): string { let n = ""; try { for (const i of list) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); } return "end"; }
function forOf_text_catch_behind(): string { let n = ""; try { for (const i of list) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen"); } return "end " + n; }
function forOf_text_catch_everywhere(): string { let n = ""; try { for (const i of list) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); } return "end " + n; }
function forOf_text_finally_inside(): string { let n = ""; try { try { for (const i of list) { say("a"); n += "x"; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function forOf_text_finally_behind(): string { let n = ""; try { try { for (const i of list) { say("a"); n += "x"; say("b"); } } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function forOf_text_finally_everywhere(): string { let n = ""; try { try { for (const i of list) { say("a"); n += "x"; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function forOf_text_both_inside(): string { let n = ""; try { for (const i of list) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); n += "x"; } finally { log.push("seen " + n); } return "end"; }
function forOf_text_both_behind(): string { let n = ""; try { for (const i of list) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen"); n += "x"; } finally { log.push("seen"); } return "end " + n; }
function forOf_text_both_everywhere(): string { let n = ""; try { for (const i of list) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); n += "x"; } finally { log.push("seen " + n); } return "end " + n; }
function forIn_counter_catch_inside(): string { let n = 0; try { for (const i in list) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); } return "end"; }
function forIn_counter_catch_behind(): string { let n = 0; try { for (const i in list) { say("a"); n++; say("b"); } } catch (e) { log.push("seen"); } return "end " + n; }
function forIn_counter_catch_everywhere(): string { let n = 0; try { for (const i in list) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); } return "end " + n; }
function forIn_counter_finally_inside(): string { let n = 0; try { try { for (const i in list) { say("a"); n++; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function forIn_counter_finally_behind(): string { let n = 0; try { try { for (const i in list) { say("a"); n++; say("b"); } } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function forIn_counter_finally_everywhere(): string { let n = 0; try { try { for (const i in list) { say("a"); n++; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function forIn_counter_both_inside(): string { let n = 0; try { for (const i in list) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); n++; } finally { log.push("seen " + n); } return "end"; }
function forIn_counter_both_behind(): string { let n = 0; try { for (const i in list) { say("a"); n++; say("b"); } } catch (e) { log.push("seen"); n++; } finally { log.push("seen"); } return "end " + n; }
function forIn_counter_both_everywhere(): string { let n = 0; try { for (const i in list) { say("a"); n++; say("b"); } } catch (e) { log.push("seen " + n); n++; } finally { log.push("seen " + n); } return "end " + n; }
function forIn_sum_catch_inside(): string { let n = 0.5; try { for (const i in list) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); } return "end"; }
function forIn_sum_catch_behind(): string { let n = 0.5; try { for (const i in list) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen"); } return "end " + n; }
function forIn_sum_catch_everywhere(): string { let n = 0.5; try { for (const i in list) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); } return "end " + n; }
function forIn_sum_finally_inside(): string { let n = 0.5; try { try { for (const i in list) { say("a"); n += 1.25; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function forIn_sum_finally_behind(): string { let n = 0.5; try { try { for (const i in list) { say("a"); n += 1.25; say("b"); } } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function forIn_sum_finally_everywhere(): string { let n = 0.5; try { try { for (const i in list) { say("a"); n += 1.25; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function forIn_sum_both_inside(): string { let n = 0.5; try { for (const i in list) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); n += 1.25; } finally { log.push("seen " + n); } return "end"; }
function forIn_sum_both_behind(): string { let n = 0.5; try { for (const i in list) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen"); n += 1.25; } finally { log.push("seen"); } return "end " + n; }
function forIn_sum_both_everywhere(): string { let n = 0.5; try { for (const i in list) { say("a"); n += 1.25; say("b"); } } catch (e) { log.push("seen " + n); n += 1.25; } finally { log.push("seen " + n); } return "end " + n; }
function forIn_text_catch_inside(): string { let n = ""; try { for (const i in list) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); } return "end"; }
function forIn_text_catch_behind(): string { let n = ""; try { for (const i in list) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen"); } return "end " + n; }
function forIn_text_catch_everywhere(): string { let n = ""; try { for (const i in list) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); } return "end " + n; }
function forIn_text_finally_inside(): string { let n = ""; try { try { for (const i in list) { say("a"); n += "x"; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end"; }
function forIn_text_finally_behind(): string { let n = ""; try { try { for (const i in list) { say("a"); n += "x"; say("b"); } } finally { log.push("seen"); } } catch (e) { log.push("out"); } return "end " + n; }
function forIn_text_finally_everywhere(): string { let n = ""; try { try { for (const i in list) { say("a"); n += "x"; say("b"); } } finally { log.push("seen " + n); } } catch (e) { log.push("out"); } return "end " + n; }
function forIn_text_both_inside(): string { let n = ""; try { for (const i in list) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); n += "x"; } finally { log.push("seen " + n); } return "end"; }
function forIn_text_both_behind(): string { let n = ""; try { for (const i in list) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen"); n += "x"; } finally { log.push("seen"); } return "end " + n; }
function forIn_text_both_everywhere(): string { let n = ""; try { for (const i in list) { say("a"); n += "x"; say("b"); } } catch (e) { log.push("seen " + n); n += "x"; } finally { log.push("seen " + n); } return "end " + n; }
const all: [string, () => string][] = [
  ["doWhile_counter_catch_inside", doWhile_counter_catch_inside],
  ["doWhile_counter_catch_behind", doWhile_counter_catch_behind],
  ["doWhile_counter_catch_everywhere", doWhile_counter_catch_everywhere],
  ["doWhile_counter_finally_inside", doWhile_counter_finally_inside],
  ["doWhile_counter_finally_behind", doWhile_counter_finally_behind],
  ["doWhile_counter_finally_everywhere", doWhile_counter_finally_everywhere],
  ["doWhile_counter_both_inside", doWhile_counter_both_inside],
  ["doWhile_counter_both_behind", doWhile_counter_both_behind],
  ["doWhile_counter_both_everywhere", doWhile_counter_both_everywhere],
  ["doWhile_sum_catch_inside", doWhile_sum_catch_inside],
  ["doWhile_sum_catch_behind", doWhile_sum_catch_behind],
  ["doWhile_sum_catch_everywhere", doWhile_sum_catch_everywhere],
  ["doWhile_sum_finally_inside", doWhile_sum_finally_inside],
  ["doWhile_sum_finally_behind", doWhile_sum_finally_behind],
  ["doWhile_sum_finally_everywhere", doWhile_sum_finally_everywhere],
  ["doWhile_sum_both_inside", doWhile_sum_both_inside],
  ["doWhile_sum_both_behind", doWhile_sum_both_behind],
  ["doWhile_sum_both_everywhere", doWhile_sum_both_everywhere],
  ["doWhile_text_catch_inside", doWhile_text_catch_inside],
  ["doWhile_text_catch_behind", doWhile_text_catch_behind],
  ["doWhile_text_catch_everywhere", doWhile_text_catch_everywhere],
  ["doWhile_text_finally_inside", doWhile_text_finally_inside],
  ["doWhile_text_finally_behind", doWhile_text_finally_behind],
  ["doWhile_text_finally_everywhere", doWhile_text_finally_everywhere],
  ["doWhile_text_both_inside", doWhile_text_both_inside],
  ["doWhile_text_both_behind", doWhile_text_both_behind],
  ["doWhile_text_both_everywhere", doWhile_text_both_everywhere],
  ["while_counter_catch_inside", while_counter_catch_inside],
  ["while_counter_catch_behind", while_counter_catch_behind],
  ["while_counter_catch_everywhere", while_counter_catch_everywhere],
  ["while_counter_finally_inside", while_counter_finally_inside],
  ["while_counter_finally_behind", while_counter_finally_behind],
  ["while_counter_finally_everywhere", while_counter_finally_everywhere],
  ["while_counter_both_inside", while_counter_both_inside],
  ["while_counter_both_behind", while_counter_both_behind],
  ["while_counter_both_everywhere", while_counter_both_everywhere],
  ["while_sum_catch_inside", while_sum_catch_inside],
  ["while_sum_catch_behind", while_sum_catch_behind],
  ["while_sum_catch_everywhere", while_sum_catch_everywhere],
  ["while_sum_finally_inside", while_sum_finally_inside],
  ["while_sum_finally_behind", while_sum_finally_behind],
  ["while_sum_finally_everywhere", while_sum_finally_everywhere],
  ["while_sum_both_inside", while_sum_both_inside],
  ["while_sum_both_behind", while_sum_both_behind],
  ["while_sum_both_everywhere", while_sum_both_everywhere],
  ["while_text_catch_inside", while_text_catch_inside],
  ["while_text_catch_behind", while_text_catch_behind],
  ["while_text_catch_everywhere", while_text_catch_everywhere],
  ["while_text_finally_inside", while_text_finally_inside],
  ["while_text_finally_behind", while_text_finally_behind],
  ["while_text_finally_everywhere", while_text_finally_everywhere],
  ["while_text_both_inside", while_text_both_inside],
  ["while_text_both_behind", while_text_both_behind],
  ["while_text_both_everywhere", while_text_both_everywhere],
  ["for_counter_catch_inside", for_counter_catch_inside],
  ["for_counter_catch_behind", for_counter_catch_behind],
  ["for_counter_catch_everywhere", for_counter_catch_everywhere],
  ["for_counter_finally_inside", for_counter_finally_inside],
  ["for_counter_finally_behind", for_counter_finally_behind],
  ["for_counter_finally_everywhere", for_counter_finally_everywhere],
  ["for_counter_both_inside", for_counter_both_inside],
  ["for_counter_both_behind", for_counter_both_behind],
  ["for_counter_both_everywhere", for_counter_both_everywhere],
  ["for_sum_catch_inside", for_sum_catch_inside],
  ["for_sum_catch_behind", for_sum_catch_behind],
  ["for_sum_catch_everywhere", for_sum_catch_everywhere],
  ["for_sum_finally_inside", for_sum_finally_inside],
  ["for_sum_finally_behind", for_sum_finally_behind],
  ["for_sum_finally_everywhere", for_sum_finally_everywhere],
  ["for_sum_both_inside", for_sum_both_inside],
  ["for_sum_both_behind", for_sum_both_behind],
  ["for_sum_both_everywhere", for_sum_both_everywhere],
  ["for_text_catch_inside", for_text_catch_inside],
  ["for_text_catch_behind", for_text_catch_behind],
  ["for_text_catch_everywhere", for_text_catch_everywhere],
  ["for_text_finally_inside", for_text_finally_inside],
  ["for_text_finally_behind", for_text_finally_behind],
  ["for_text_finally_everywhere", for_text_finally_everywhere],
  ["for_text_both_inside", for_text_both_inside],
  ["for_text_both_behind", for_text_both_behind],
  ["for_text_both_everywhere", for_text_both_everywhere],
  ["forOf_counter_catch_inside", forOf_counter_catch_inside],
  ["forOf_counter_catch_behind", forOf_counter_catch_behind],
  ["forOf_counter_catch_everywhere", forOf_counter_catch_everywhere],
  ["forOf_counter_finally_inside", forOf_counter_finally_inside],
  ["forOf_counter_finally_behind", forOf_counter_finally_behind],
  ["forOf_counter_finally_everywhere", forOf_counter_finally_everywhere],
  ["forOf_counter_both_inside", forOf_counter_both_inside],
  ["forOf_counter_both_behind", forOf_counter_both_behind],
  ["forOf_counter_both_everywhere", forOf_counter_both_everywhere],
  ["forOf_sum_catch_inside", forOf_sum_catch_inside],
  ["forOf_sum_catch_behind", forOf_sum_catch_behind],
  ["forOf_sum_catch_everywhere", forOf_sum_catch_everywhere],
  ["forOf_sum_finally_inside", forOf_sum_finally_inside],
  ["forOf_sum_finally_behind", forOf_sum_finally_behind],
  ["forOf_sum_finally_everywhere", forOf_sum_finally_everywhere],
  ["forOf_sum_both_inside", forOf_sum_both_inside],
  ["forOf_sum_both_behind", forOf_sum_both_behind],
  ["forOf_sum_both_everywhere", forOf_sum_both_everywhere],
  ["forOf_text_catch_inside", forOf_text_catch_inside],
  ["forOf_text_catch_behind", forOf_text_catch_behind],
  ["forOf_text_catch_everywhere", forOf_text_catch_everywhere],
  ["forOf_text_finally_inside", forOf_text_finally_inside],
  ["forOf_text_finally_behind", forOf_text_finally_behind],
  ["forOf_text_finally_everywhere", forOf_text_finally_everywhere],
  ["forOf_text_both_inside", forOf_text_both_inside],
  ["forOf_text_both_behind", forOf_text_both_behind],
  ["forOf_text_both_everywhere", forOf_text_both_everywhere],
  ["forIn_counter_catch_inside", forIn_counter_catch_inside],
  ["forIn_counter_catch_behind", forIn_counter_catch_behind],
  ["forIn_counter_catch_everywhere", forIn_counter_catch_everywhere],
  ["forIn_counter_finally_inside", forIn_counter_finally_inside],
  ["forIn_counter_finally_behind", forIn_counter_finally_behind],
  ["forIn_counter_finally_everywhere", forIn_counter_finally_everywhere],
  ["forIn_counter_both_inside", forIn_counter_both_inside],
  ["forIn_counter_both_behind", forIn_counter_both_behind],
  ["forIn_counter_both_everywhere", forIn_counter_both_everywhere],
  ["forIn_sum_catch_inside", forIn_sum_catch_inside],
  ["forIn_sum_catch_behind", forIn_sum_catch_behind],
  ["forIn_sum_catch_everywhere", forIn_sum_catch_everywhere],
  ["forIn_sum_finally_inside", forIn_sum_finally_inside],
  ["forIn_sum_finally_behind", forIn_sum_finally_behind],
  ["forIn_sum_finally_everywhere", forIn_sum_finally_everywhere],
  ["forIn_sum_both_inside", forIn_sum_both_inside],
  ["forIn_sum_both_behind", forIn_sum_both_behind],
  ["forIn_sum_both_everywhere", forIn_sum_both_everywhere],
  ["forIn_text_catch_inside", forIn_text_catch_inside],
  ["forIn_text_catch_behind", forIn_text_catch_behind],
  ["forIn_text_catch_everywhere", forIn_text_catch_everywhere],
  ["forIn_text_finally_inside", forIn_text_finally_inside],
  ["forIn_text_finally_behind", forIn_text_finally_behind],
  ["forIn_text_finally_everywhere", forIn_text_finally_everywhere],
  ["forIn_text_both_inside", forIn_text_both_inside],
  ["forIn_text_both_behind", forIn_text_both_behind],
  ["forIn_text_both_everywhere", forIn_text_both_everywhere],
];
for (const [name, run] of all) {
  for (failsAt = -1; failsAt < 7; failsAt++) {
    calls = 0; log.length = 0;
    const answer = run();
    console.log(name, failsAt, answer, log.join());
  }
}
