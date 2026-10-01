/*expected
initial->s1_1->s1_2->s1_3->s1_4->s1_5->s1_6->s1_7->s1_2;
s1_3->s1_6;
s1_4->s1_11->s1_12->s1_13->s1_14->s1_15->s1_16->s1_17->s1_18->s1_19->s1_18;
s1_6->s1_9->s1_2;
s1_7->s1_8->s1_9;
s1_11->s1_14;
s1_12->s1_17;
s1_14->s1_16;
s1_19->s1_20->s1_19;
s1_9->s1_10->s1_11;
s1_20->s1_21->s1_18;
s1_21->s1_22->s1_23->s1_24->s1_25->s1_25;
s1_22->s1_24;
s1_25->s1_26->s1_28->s1_27->s1_29->s1_27;
s1_28->s1_30->s1_32->s1_31->s1_33->s1_31;
s1_29->s1_30;
s1_32->s1_34;
s1_33->s1_34;
*/
a: b: while (1) { if (c) break a; if (d) continue b; e; }
f: { g: { if (h) break f; break g; } i; }
j: for (;;) { k: for (;;) { continue j; } }
l: switch (m) { case 1: break l; }
n: do { continue n; } while (o);
p: q: r;
s: for (t in u) { continue s; }
v: for (w of x) { break v; }
