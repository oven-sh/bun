/*languageOptions
    {"sourceType":"module"}
*/
/*expected
initial->s1_1->s1_2->s1_3->s1_4->s1_5->s1_6;
s1_1->s1_3;
s1_2->s1_4->s1_7;
s1_5->s1_7;
s1_6->final;
s1_7->thrown;
*/
try { import.meta; } catch (e) { c; }
try { import.meta.url; } finally { d; }
