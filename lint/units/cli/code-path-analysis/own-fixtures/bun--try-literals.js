/*expected
initial->s3_1->final;
*/
/*expected
initial->s4_1->s4_2;
s4_1->final;
*/
/*expected
initial->s2_1->s2_2->s2_3->s2_4->s2_5->s2_6->s2_7->s2_8->s2_9->s2_10->s2_11->s2_12->s2_13->s2_14->s2_15->s2_16->s2_17->s2_18;
s2_1->s2_3;
s2_2->s2_4->s2_6;
s2_5->s2_7->s2_9;
s2_8->s2_10->s2_12;
s2_11->s2_13->s2_15;
s2_14->s2_16->s2_18->final;
*/
/*expected
initial->s1_1->final;
*/
function f() {
    try { x = { a, b: c, [d]: e, f() {}, get g() { return 1; }, ...h, 'i': 1, 2: j }; } catch (e) { z; }
    try { `a${b}c`; } catch (e) { z; }
    try { tag`x${y}`; } catch (e) { z; }
    try { (a, b), c; } catch (e) { z; }
    try { [a, , b]; } catch (e) { z; }
    try { 1; 'two'; /three/; null; true; 4n; } catch (e) { z; }
}
