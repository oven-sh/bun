/*expected
initial->s2_1->s2_3->s2_4->s2_5;
s2_1->s2_6;
s2_3->s2_6;
s2_4->s2_6->final;
s2_5->final;
s2_6->thrown;
*/
/*expected
initial->s3_1->s3_2->s3_3->s3_4->s3_5->s3_6->s3_7->s3_2;
s3_4->s3_7->s3_8;
s3_3->final;
s3_5->final;
s3_3->thrown;
*/
/*expected
initial->s4_1->s4_3->s4_2->s4_4->s4_5->s4_2;
s4_3->s4_6;
s4_5->s4_6;
s4_4->final;
s4_6->final;
s4_4->thrown;
*/
/*expected
initial->s1_1->final;
*/
function* g() { try { yield a; yield* b; } finally { c; } }
function* h() { while (true) { const x = yield; if (x) return; } }
async function* i() { for await (const y of z) yield y; }
