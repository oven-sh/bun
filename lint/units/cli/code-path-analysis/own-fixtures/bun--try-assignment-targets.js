/*expected
initial->s2_1->s2_2->s2_3->s2_4->s2_5->s2_6->s2_7->s2_8->s2_9->s2_10->s2_11->s2_12->s2_13->s2_15->s2_16->s2_17->s2_18->s2_19->s2_20->s2_21->s2_22->s2_23;
s2_1->s2_3;
s2_2->s2_4->s2_6;
s2_5->s2_7->s2_9;
s2_8->s2_10->s2_12;
s2_11->s2_13->s2_16->s2_18->s2_22;
s2_19->s2_21->s2_23;
s2_13->s2_17;
s2_23->final;
*/
/*expected
initial->s1_1->final;
*/
function f() {
    try { ({ a } = b); } catch (e) { c; }
    try { ({ a: b } = c); } catch (e) { d; }
    try { [a] = b; } catch (e) { c; }
    try { [...a] = b; } catch (e) { c; }
    try { [a = 1] = b; } catch (e) { c; }
    try { ({ a = 1, ...r } = b); } catch (e) { c; }
}
