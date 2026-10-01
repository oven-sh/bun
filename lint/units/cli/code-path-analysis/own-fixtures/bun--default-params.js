/*expected
initial->s2_1->s2_2->s2_3->s2_4->s2_5->s2_6->s2_7->s2_8->s2_9->s2_10->s2_11->s2_12->s2_13;
s2_1->s2_5;
s2_2->s2_4;
s2_5->s2_7->s2_9->s2_11->s2_13->final;
*/
/*expected
initial->s3_1->s3_2->s3_3->s3_5->s3_6;
s3_1->s3_6;
s3_2->s3_4->s3_5;
s3_6->final;
*/
/*expected
initial->s4_1->s4_2->s4_3;
s4_1->s4_3->final;
*/
/*expected
initial->s5_1->s5_2->s5_3;
s5_1->s5_3->final;
*/
/*expected
initial->s1_1->final;
*/
function f(a = b || c, { d = e } = {}, [g = h] = [], ...i) { j; }
var k = ({ l = m ? n : o }) => l;
class P { q(r = s) { t; } set u(v = w) {} }
