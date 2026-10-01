/*expected
initial->s2_1->s2_2->s2_3->s2_4->s2_5->s2_6->s2_7->s2_8->s2_9->s2_10->s2_11->s2_12->s2_13->s2_14->s2_15->s2_16->s2_18->s2_19->s2_20->s2_21->s2_23->s2_25->s2_26->s2_27->s2_29;
s2_1->s2_3;
s2_2->s2_4->s2_6;
s2_5->s2_7->s2_9;
s2_8->s2_10->s2_12;
s2_11->s2_13->s2_15;
s2_14->s2_16->s2_19->s2_23;
s2_20->s2_24;
s2_21->s2_24;
s2_23->s2_26;
s2_25->s2_29;
s2_26->s2_30;
s2_27->s2_30;
s2_16->s2_20;
s2_29->final;
s2_24->thrown;
s2_30->thrown;
*/
/*expected
initial->s1_1->final;
*/
function f() {
    try { var { a } = b; } catch (e) { c; }
    try { var [a] = b; } catch (e) { c; }
    try { var { a: x } = b; } catch (e) { c; }
    try { var { [k]: v } = o; } catch (e) { c; }
    try { var { ...r } = o; } catch (e) { c; }
    try { var [p = 1, ...q] = o; } catch ({ message }) { c; } finally { d; }
    try { throw 1; } catch ([e1]) { c; } finally { d; }
}
