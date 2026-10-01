/*expected
initial->s1_1->s1_2->s1_3->s1_4->s1_5->s1_6->s1_4;
s1_1->s1_3;
s1_4->s1_7->s1_8->s1_9->s1_10->s1_11;
s1_7->s1_9->s1_11->final;
*/
a, b, c;
(a, b), c;
a, (b, c);
if (a, b) c;
for (a, b; c, d; e, f) g;
x = (a || b, c && d);
