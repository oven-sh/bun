/*expected
initial->s2_1->s2_4->s2_2->s2_5->s2_2;
s2_4->s2_6->s2_7;
s2_2->s2_8;
s2_5->s2_6->s2_8;
s2_7->final;
s2_8->thrown;
*/
/*expected
initial->s1_1->final;
*/
async function f() { try { for await (x of y) {} } finally {} }
