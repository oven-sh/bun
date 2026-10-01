/*expected
initial->s2_1->s2_2->s2_3;
s2_1->s2_3->final;
*/
/*expected
initial->s3_1->final;
*/
/*expected
initial->s5_1->s5_2->s5_4;
s5_1->s5_3->s5_4->final;
*/
/*expected
initial->s4_1->final;
*/
/*expected
initial->s6_1->final;
*/
/*expected
initial->s7_1->s7_2->s7_3->s7_4;
s7_1->s7_3->final;
*/
/*expected
initial->s1_1->final;
*/
x = () => a || b;
y = async () => await z;
w = a => b => c ? d : e;
v = () => ({ a });
u = () => { return a && b; };
