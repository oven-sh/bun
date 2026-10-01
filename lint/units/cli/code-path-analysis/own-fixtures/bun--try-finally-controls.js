/*expected
initial->s2_1->s2_2->s2_4->s2_5->s2_6->s2_7->s2_2->s2_6;
s2_4->s2_15->s2_16->s2_17->s2_18->s2_19->s2_21->s2_24->s2_26->s2_27->s2_29->s2_31->s2_32->s2_33->s2_35->s2_37;
s2_6->s2_9->s2_10->s2_11->s2_12->s2_13->s2_2;
s2_7->s2_8->s2_9;
s2_2->s2_14;
s2_15->s2_17;
s2_16->s2_21;
s2_17->s2_22->s2_25->s2_26;
s2_18->s2_22;
s2_19->s2_22;
s2_21->s2_26;
s2_24->s2_29;
s2_26->s2_30;
s2_27->s2_30;
s2_29->s2_34->s2_36->s2_38;
s2_31->s2_34;
s2_32->s2_34;
s2_33->s2_39;
s2_35->s2_39;
s2_9->s2_12;
s2_10->s2_14;
s2_12->s2_14;
s2_22->s2_26;
s2_34->s2_40;
s2_36->s2_40;
s2_14->final;
s2_38->final;
s2_14->thrown;
s2_30->thrown;
s2_39->thrown;
s2_40->thrown;
s2_38->thrown;
*/
/*expected
initial->s1_1->final;
*/
function f() {
    a: for (;;) { try { if (b) break a; if (c) continue; if (d) return; e(); } finally { g(); } }
    try { try { h(); } catch (i) { throw i; } finally { j(); } } catch (k) { l(); } finally { m(); }
    try { return n; } finally { try { o(); } finally { p(); } }
}
