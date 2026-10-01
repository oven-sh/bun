/*expected
initial->s2_1->s2_2->s2_3->s2_4->s2_5->s2_6->s2_7->s2_8->s2_9->s2_10->s2_11->s2_12->s2_13->s2_14->s2_15;
s2_1->s2_3;
s2_2->s2_4->s2_6;
s2_5->s2_7->s2_9;
s2_8->s2_10->s2_12;
s2_11->s2_13->s2_16;
s2_14->s2_16;
s2_15->final;
s2_16->thrown;
*/
/*expected
initial->s3_1->s3_2->s3_3->s3_4->s3_5->s3_6;
s3_1->s3_3;
s3_2->s3_4->s3_6->final;
*/
/*expected
initial->s1_1->final;
*/
function f() {
    try { a.b; } catch (e) { c; }
    try { a[b]; } catch (e) { c; }
    try { new.target; } catch (e) { c; }
    try { this.x; } catch (e) { c; }
    try { super_.y(); } finally { d; }
}
class A { #p; m() { try { this.#p; } catch (e) { c; } try { #p in this; } catch (e) { c; } } }
