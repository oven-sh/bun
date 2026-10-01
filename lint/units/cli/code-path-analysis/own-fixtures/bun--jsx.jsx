/*languageOptions
    {"parserOptions":{"ecmaFeatures":{"jsx":true}}}
*/
/*expected
initial->s2_1->final;
*/
/*expected
initial->s1_1->s1_2->s1_3->s1_4->s1_6->s1_7->s1_8->s1_9->s1_10->s1_11->s1_12->s1_13;
s1_1->s1_3->s1_5->s1_6->s1_8->s1_10;
s1_9->s1_11->s1_13->final;
*/
x = <A b={c || d} {...e} f="g" h>{i ? j : k}<l.m n={() => o} />text{p && <q />}</A>;
try { <R s={t} />; } catch (e) { u; }
y = <>{v ?? w}</>;
