/*expected
initial->s1_1->s1_2->s1_5->s1_7->s1_8->s1_9->s1_11->s1_12->s1_14->s1_15->s1_16->s1_19->s1_20->s1_21->s1_23->s1_24;
s1_1->s1_3->s1_5;
s1_7->s1_6->s1_8;
s1_11->s1_13->s1_14;
s1_15->s1_17->s1_19->s1_22->s1_23;
s1_20->s1_24;
s1_13->s1_12;
s1_24->final;
*/
switch (a) { case 1: ; case 2: }
switch (b) { default: ; case 1: foo(); }
switch (c) { default: case 1: foo(); case 2: ; }
switch (d) { case 1: bar(); default: }
switch (e) { default: }
switch (f) { default: ; }
switch (g) { case 1: ; break; default: ; }
