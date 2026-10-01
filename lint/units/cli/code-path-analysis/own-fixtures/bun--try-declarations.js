/*expected
initial->s3_1->final;
*/
/*expected
initial->s4_1->final;
*/
/*expected
initial->s5_1->final;
*/
/*expected
initial->s6_1->final;
*/
/*expected
initial->s2_1->s2_2->s2_3->s2_4->s2_5->s2_6->s2_7->s2_8->s2_9->s2_10->s2_11->s2_12->s2_13->s2_14->s2_15;
s2_1->s2_3;
s2_2->s2_4->s2_6->s2_8;
s2_7->s2_9->s2_11->s2_13->s2_15->final;
*/
/*expected
initial->s1_1->final;
*/
function f() {
    try { label: x; } catch (e) { c; }
    try { function g(a) {} } catch (e) { c; }
    try { class A { m() {} [k]() {} static s = 1; } } catch (e) { c; }
    try { let u; const w = 1; } catch (e) { c; }
    try { ; } catch (e) { c; }
    try { 'use strict'; 'x'; } catch (e) { c; }
}
