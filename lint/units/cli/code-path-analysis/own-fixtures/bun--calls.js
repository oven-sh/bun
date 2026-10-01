/*expected
initial->s1_1->s1_2->s1_3->s1_4->s1_5->s1_6->s1_8->s1_9->s1_10->s1_11->s1_12->s1_13->s1_15->s1_16->s1_17;
s1_1->s1_3->s1_5->s1_7->s1_8->s1_12;
s1_9->s1_11;
s1_12->s1_14->s1_15->s1_17->final;
*/
new a.b(c || d);
import(e || f);
g(...h, i ? j : k);
l?.(m && n);
o[p ? q : r](s);
t`u${v || w}`;
new X;
super_(y)(z);
