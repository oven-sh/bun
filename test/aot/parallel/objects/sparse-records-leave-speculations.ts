// Literals that leave out most of what their written type requires stand beside classes that fill it. Reads off the written type speculate on the classes; the literals answer as they are.
interface Knot { sort: number; marks: number; from: number; till: number; owner?: Knot; name?: string }
interface Config extends Knot { title: string; faults: string[] }
interface Missing extends Knot { reason: string }
class Label implements Knot { sort = 1; marks = 0; from: number; till: number; owner?: Knot; name?: string; constructor(from: number, name: string) { this.from = from; this.till = from + name.length; this.name = name; } }
class Call implements Knot { sort = 2; marks = 4; from: number; till: number; owner?: Knot; head: Knot; constructor(head: Knot) { this.from = head.from; this.till = head.till + 2; this.head = head; head.owner = this; } }
class Block implements Knot { sort = 3; marks = 8; from = 0; till = 0; owner?: Knot; steps: Knot[]; constructor(steps: Knot[]) { this.steps = steps; for (const s of steps) { s.owner = this; this.till = Math.max(this.till, s.till || 0); } } }
class Other0 implements Knot { sort = 10; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 0; } }
class Other1 implements Knot { sort = 11; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 1; } }
class Other2 implements Knot { sort = 12; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 2; } }
class Other3 implements Knot { sort = 13; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 3; } }
class Other4 implements Knot { sort = 14; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 4; } }
class Other5 implements Knot { sort = 15; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 5; } }
class Other6 implements Knot { sort = 16; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 6; } }
class Other7 implements Knot { sort = 17; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 7; } }
class Other8 implements Knot { sort = 18; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 8; } }
class Other9 implements Knot { sort = 19; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 9; } }
class Other10 implements Knot { sort = 20; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 10; } }
class Other11 implements Knot { sort = 21; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 11; } }
class Other12 implements Knot { sort = 22; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 12; } }
class Other13 implements Knot { sort = 23; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 13; } }
class Other14 implements Knot { sort = 24; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 14; } }
class Other15 implements Knot { sort = 25; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 15; } }
class Other16 implements Knot { sort = 26; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 16; } }
class Other17 implements Knot { sort = 27; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 17; } }
class Other18 implements Knot { sort = 28; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 18; } }
class Other19 implements Knot { sort = 29; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 19; } }
class Other20 implements Knot { sort = 30; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 20; } }
class Other21 implements Knot { sort = 31; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 21; } }
class Other22 implements Knot { sort = 32; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 22; } }
class Other23 implements Knot { sort = 33; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 23; } }
class Other24 implements Knot { sort = 34; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 24; } }
class Other25 implements Knot { sort = 35; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 25; } }
class Other26 implements Knot { sort = 36; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 26; } }
class Other27 implements Knot { sort = 37; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 27; } }
class Other28 implements Knot { sort = 38; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 28; } }
class Other29 implements Knot { sort = 39; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 29; } }
class Other30 implements Knot { sort = 40; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 30; } }
class Other31 implements Knot { sort = 41; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 31; } }
class Other32 implements Knot { sort = 42; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 32; } }
class Other33 implements Knot { sort = 43; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 33; } }
class Other34 implements Knot { sort = 44; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 34; } }
class Other35 implements Knot { sort = 45; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 35; } }
class Other36 implements Knot { sort = 46; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 36; } }
class Other37 implements Knot { sort = 47; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 37; } }
class Other38 implements Knot { sort = 48; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 38; } }
class Other39 implements Knot { sort = 49; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 39; } }
class Other40 implements Knot { sort = 50; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 40; } }
class Other41 implements Knot { sort = 51; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 41; } }
class Other42 implements Knot { sort = 52; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 42; } }
class Other43 implements Knot { sort = 53; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 43; } }
class Other44 implements Knot { sort = 54; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 44; } }
class Other45 implements Knot { sort = 55; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 45; } }
class Other46 implements Knot { sort = 56; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 46; } }
class Other47 implements Knot { sort = 57; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 47; } }
class Other48 implements Knot { sort = 58; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 48; } }
class Other49 implements Knot { sort = 59; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 49; } }
class Other50 implements Knot { sort = 60; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 50; } }
class Other51 implements Knot { sort = 61; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 51; } }
class Other52 implements Knot { sort = 62; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 52; } }
class Other53 implements Knot { sort = 63; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 53; } }
class Other54 implements Knot { sort = 64; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 54; } }
class Other55 implements Knot { sort = 65; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 55; } }
class Other56 implements Knot { sort = 66; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 56; } }
class Other57 implements Knot { sort = 67; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 57; } }
class Other58 implements Knot { sort = 68; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 58; } }
class Other59 implements Knot { sort = 69; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 59; } }
class Other60 implements Knot { sort = 70; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 60; } }
class Other61 implements Knot { sort = 71; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 61; } }
class Other62 implements Knot { sort = 72; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 62; } }
class Other63 implements Knot { sort = 73; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 63; } }
class Other64 implements Knot { sort = 74; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 64; } }
class Other65 implements Knot { sort = 75; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 65; } }
class Other66 implements Knot { sort = 76; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 66; } }
class Other67 implements Knot { sort = 77; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 67; } }
class Other68 implements Knot { sort = 78; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 68; } }
class Other69 implements Knot { sort = 79; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 69; } }
class Other70 implements Knot { sort = 80; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 70; } }
class Other71 implements Knot { sort = 81; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 71; } }
class Other72 implements Knot { sort = 82; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 72; } }
class Other73 implements Knot { sort = 83; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 73; } }
class Other74 implements Knot { sort = 84; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 74; } }
class Other75 implements Knot { sort = 85; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 75; } }
class Other76 implements Knot { sort = 86; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 76; } }
class Other77 implements Knot { sort = 87; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 77; } }
class Other78 implements Knot { sort = 88; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 78; } }
class Other79 implements Knot { sort = 89; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 79; } }
class Other80 implements Knot { sort = 90; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 80; } }
class Other81 implements Knot { sort = 91; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 81; } }
class Other82 implements Knot { sort = 92; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 82; } }
class Other83 implements Knot { sort = 93; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 83; } }
class Other84 implements Knot { sort = 94; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 84; } }
class Other85 implements Knot { sort = 95; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 85; } }
class Other86 implements Knot { sort = 96; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 86; } }
class Other87 implements Knot { sort = 97; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 87; } }
class Other88 implements Knot { sort = 98; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 88; } }
class Other89 implements Knot { sort = 99; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 89; } }
class Other90 implements Knot { sort = 100; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 90; } }
class Other91 implements Knot { sort = 101; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 91; } }
class Other92 implements Knot { sort = 102; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 92; } }
class Other93 implements Knot { sort = 103; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 93; } }
class Other94 implements Knot { sort = 104; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 94; } }
class Other95 implements Knot { sort = 105; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 95; } }
class Other96 implements Knot { sort = 106; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 96; } }
class Other97 implements Knot { sort = 107; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 97; } }
class Other98 implements Knot { sort = 108; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 98; } }
class Other99 implements Knot { sort = 109; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 99; } }
class Other100 implements Knot { sort = 110; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 100; } }
class Other101 implements Knot { sort = 111; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 101; } }
class Other102 implements Knot { sort = 112; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 102; } }
class Other103 implements Knot { sort = 113; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 103; } }
class Other104 implements Knot { sort = 114; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 104; } }
class Other105 implements Knot { sort = 115; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 105; } }
class Other106 implements Knot { sort = 116; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 106; } }
class Other107 implements Knot { sort = 117; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 107; } }
class Other108 implements Knot { sort = 118; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 108; } }
class Other109 implements Knot { sort = 119; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 109; } }
class Other110 implements Knot { sort = 120; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 110; } }
class Other111 implements Knot { sort = 121; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 111; } }
class Other112 implements Knot { sort = 122; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 112; } }
class Other113 implements Knot { sort = 123; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 113; } }
class Other114 implements Knot { sort = 124; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 114; } }
class Other115 implements Knot { sort = 125; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 115; } }
class Other116 implements Knot { sort = 126; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 116; } }
class Other117 implements Knot { sort = 127; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 117; } }
class Other118 implements Knot { sort = 128; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 118; } }
class Other119 implements Knot { sort = 129; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 119; } }
class Other120 implements Knot { sort = 130; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 120; } }
class Other121 implements Knot { sort = 131; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 121; } }
class Other122 implements Knot { sort = 132; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 122; } }
class Other123 implements Knot { sort = 133; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 123; } }
class Other124 implements Knot { sort = 134; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 124; } }
class Other125 implements Knot { sort = 135; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 125; } }
class Other126 implements Knot { sort = 136; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 126; } }
class Other127 implements Knot { sort = 137; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 127; } }
class Other128 implements Knot { sort = 138; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 128; } }
class Other129 implements Knot { sort = 139; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 129; } }
class Other130 implements Knot { sort = 140; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 130; } }
class Other131 implements Knot { sort = 141; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 131; } }
class Other132 implements Knot { sort = 142; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 132; } }
class Other133 implements Knot { sort = 143; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 133; } }
class Other134 implements Knot { sort = 144; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 134; } }
class Other135 implements Knot { sort = 145; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 135; } }
class Other136 implements Knot { sort = 146; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 136; } }
class Other137 implements Knot { sort = 147; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 137; } }
class Other138 implements Knot { sort = 148; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 138; } }
class Other139 implements Knot { sort = 149; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 139; } }
class Other140 implements Knot { sort = 150; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 140; } }
class Other141 implements Knot { sort = 151; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 141; } }
class Other142 implements Knot { sort = 152; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 142; } }
class Other143 implements Knot { sort = 153; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 143; } }
class Other144 implements Knot { sort = 154; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 144; } }
class Other145 implements Knot { sort = 155; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 145; } }
class Other146 implements Knot { sort = 156; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 146; } }
class Other147 implements Knot { sort = 157; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 147; } }
class Other148 implements Knot { sort = 158; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 148; } }
class Other149 implements Knot { sort = 159; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 149; } }
class Other150 implements Knot { sort = 160; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 150; } }
class Other151 implements Knot { sort = 161; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 151; } }
class Other152 implements Knot { sort = 162; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 152; } }
class Other153 implements Knot { sort = 163; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 153; } }
class Other154 implements Knot { sort = 164; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 154; } }
class Other155 implements Knot { sort = 165; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 155; } }
class Other156 implements Knot { sort = 166; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 156; } }
class Other157 implements Knot { sort = 167; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 157; } }
class Other158 implements Knot { sort = 168; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 158; } }
class Other159 implements Knot { sort = 169; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 159; } }
class Other160 implements Knot { sort = 170; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 160; } }
class Other161 implements Knot { sort = 171; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 161; } }
class Other162 implements Knot { sort = 172; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 162; } }
class Other163 implements Knot { sort = 173; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 163; } }
class Other164 implements Knot { sort = 174; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 164; } }
class Other165 implements Knot { sort = 175; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 165; } }
class Other166 implements Knot { sort = 176; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 166; } }
class Other167 implements Knot { sort = 177; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 167; } }
class Other168 implements Knot { sort = 178; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 168; } }
class Other169 implements Knot { sort = 179; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 169; } }
class Other170 implements Knot { sort = 180; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 170; } }
class Other171 implements Knot { sort = 181; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 171; } }
class Other172 implements Knot { sort = 182; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 172; } }
class Other173 implements Knot { sort = 183; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 173; } }
class Other174 implements Knot { sort = 184; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 174; } }
class Other175 implements Knot { sort = 185; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 175; } }
class Other176 implements Knot { sort = 186; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 176; } }
class Other177 implements Knot { sort = 187; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 177; } }
class Other178 implements Knot { sort = 188; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 178; } }
class Other179 implements Knot { sort = 189; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 179; } }
class Other180 implements Knot { sort = 190; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 180; } }
class Other181 implements Knot { sort = 191; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 181; } }
class Other182 implements Knot { sort = 192; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 182; } }
class Other183 implements Knot { sort = 193; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 183; } }
class Other184 implements Knot { sort = 194; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 184; } }
class Other185 implements Knot { sort = 195; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 185; } }
class Other186 implements Knot { sort = 196; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 186; } }
class Other187 implements Knot { sort = 197; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 187; } }
class Other188 implements Knot { sort = 198; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 188; } }
class Other189 implements Knot { sort = 199; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 189; } }
class Other190 implements Knot { sort = 200; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 190; } }
class Other191 implements Knot { sort = 201; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 191; } }
class Other192 implements Knot { sort = 202; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 192; } }
class Other193 implements Knot { sort = 203; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 193; } }
class Other194 implements Knot { sort = 204; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 194; } }
class Other195 implements Knot { sort = 205; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 195; } }
class Other196 implements Knot { sort = 206; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 196; } }
class Other197 implements Knot { sort = 207; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 197; } }
class Other198 implements Knot { sort = 208; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 198; } }
class Other199 implements Knot { sort = 209; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 199; } }
class Other200 implements Knot { sort = 210; marks = 1; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 200; } }
class Other201 implements Knot { sort = 211; marks = 2; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 201; } }
class Other202 implements Knot { sort = 212; marks = 4; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 202; } }
class Other203 implements Knot { sort = 213; marks = 8; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 203; } }
class Other204 implements Knot { sort = 214; marks = 16; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 204; } }
class Other205 implements Knot { sort = 215; marks = 32; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 205; } }
class Other206 implements Knot { sort = 216; marks = 64; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 206; } }
class Other207 implements Knot { sort = 217; marks = 128; from: number; till: number; owner?: Knot; constructor(from: number) { this.from = from; this.till = from + 207; } }
function missing(title: string, text: string): Config { return { title, faults: [text] } as Config; }
function absent(reason: string): Missing { const node = { reason } as Missing; if (reason.length > 4) { node.sort = 9; node.marks = 1; } return node; }
function empty(): Knot { return {} as Knot; }
const show = (v: unknown): string => JSON.stringify(v, (k, x) => k === "owner" ? "@" : x === undefined ? "@undefined" : typeof x === "number" && !Number.isFinite(x) ? String(x) : x) ?? String(v);
function describe(node: Knot): string { return node.sort + ":" + node.marks + ":" + (node.sort & node.marks) + ":" + (node.till - node.from) + ":" + node.name; }
function count(nodes: Knot[]): number { let n = 0; for (const node of nodes) { if (node.sort === 2) n += node.marks; else if (node.marks & 8) n += 100; n += node.owner ? 1 : 0; } return n; }
function mark(node: Knot, marks: number): number { node.marks |= marks; return node.marks; }
function depth(node: Knot | undefined): number { let d = 0; while (node) { d++; node = node.owner; } return d; }
const others: any = globalThis;
const nodes: Knot[] = [];
for (let i = 0; i < 12; i++) nodes.push(new Call(new Label(i, "name" + i)));
const all: Knot[] = [new Block(nodes), ...nodes, new Other0(1), new Other1(2), new Other2(3), new Other3(4), new Other4(5), new Other5(6), new Other6(7), new Other7(8), missing("a.json", "unread"), absent("none"), absent("reason"), empty()];
others.kept = { all, describe };
others["run" + all.length]?.(all);
const attempt = (f: () => unknown): string => { try { return show(f()); } catch (e) { return (e as Error).constructor.name; } };
for (let k = 0; k < 3; k++) {
  console.log(attempt(() => count(all)));
  for (const node of all) console.log(attempt(() => describe(node)), attempt(() => mark(node, 1 << k)), depth(node), "sort" in node, Object.keys(node).join());
  (all[21] as any).sort = k; (all[24] as any).till = k / 2; delete (all[2] as any).marks;
}
console.log(show(all.slice(21)));
all.push(Object.freeze(missing("b.json", "frozen")), new Proxy(missing("c.json", "proxy"), {}), Object.create(all[0]), { get sort() { return 5; }, marks: 1 } as any, undefined as any, null as any, 5 as any);
for (const node of all.slice(25)) console.log(attempt(() => describe(node)), attempt(() => mark(node, 64)), attempt(() => count([node])));
const more: Knot[] = [new Other8(8), new Other9(9), new Other10(10), new Other11(11), new Other12(12), new Other13(13), new Other14(14), new Other15(15), new Other16(16), new Other17(17), new Other18(18), new Other19(19), new Other20(20), new Other21(21), new Other22(22), new Other23(23), new Other24(24), new Other25(25), new Other26(26), new Other27(27), new Other28(28), new Other29(29), new Other30(30), new Other31(31), new Other32(32), new Other33(33), new Other34(34), new Other35(35), new Other36(36), new Other37(37), new Other38(38), new Other39(39), new Other40(40), new Other41(41), new Other42(42), new Other43(43), new Other44(44), new Other45(45), new Other46(46), new Other47(47), new Other48(48), new Other49(49), new Other50(50), new Other51(51), new Other52(52), new Other53(53), new Other54(54), new Other55(55), new Other56(56), new Other57(57), new Other58(58), new Other59(59), new Other60(60), new Other61(61), new Other62(62), new Other63(63), new Other64(64), new Other65(65), new Other66(66), new Other67(67), new Other68(68), new Other69(69), new Other70(70), new Other71(71), new Other72(72), new Other73(73), new Other74(74), new Other75(75), new Other76(76), new Other77(77), new Other78(78), new Other79(79), new Other80(80), new Other81(81), new Other82(82), new Other83(83), new Other84(84), new Other85(85), new Other86(86), new Other87(87), new Other88(88), new Other89(89), new Other90(90), new Other91(91), new Other92(92), new Other93(93), new Other94(94), new Other95(95), new Other96(96), new Other97(97), new Other98(98), new Other99(99), new Other100(100), new Other101(101), new Other102(102), new Other103(103), new Other104(104), new Other105(105), new Other106(106), new Other107(107), new Other108(108), new Other109(109), new Other110(110), new Other111(111), new Other112(112), new Other113(113), new Other114(114), new Other115(115), new Other116(116), new Other117(117), new Other118(118), new Other119(119), new Other120(120), new Other121(121), new Other122(122), new Other123(123), new Other124(124), new Other125(125), new Other126(126), new Other127(127), new Other128(128), new Other129(129), new Other130(130), new Other131(131), new Other132(132), new Other133(133), new Other134(134), new Other135(135), new Other136(136), new Other137(137), new Other138(138), new Other139(139), new Other140(140), new Other141(141), new Other142(142), new Other143(143), new Other144(144), new Other145(145), new Other146(146), new Other147(147), new Other148(148), new Other149(149), new Other150(150), new Other151(151), new Other152(152), new Other153(153), new Other154(154), new Other155(155), new Other156(156), new Other157(157), new Other158(158), new Other159(159), new Other160(160), new Other161(161), new Other162(162), new Other163(163), new Other164(164), new Other165(165), new Other166(166), new Other167(167), new Other168(168), new Other169(169), new Other170(170), new Other171(171), new Other172(172), new Other173(173), new Other174(174), new Other175(175), new Other176(176), new Other177(177), new Other178(178), new Other179(179), new Other180(180), new Other181(181), new Other182(182), new Other183(183), new Other184(184), new Other185(185), new Other186(186), new Other187(187), new Other188(188), new Other189(189), new Other190(190), new Other191(191), new Other192(192), new Other193(193), new Other194(194), new Other195(195), new Other196(196), new Other197(197), new Other198(198), new Other199(199), new Other200(200), new Other201(201), new Other202(202), new Other203(203), new Other204(204), new Other205(205), new Other206(206), new Other207(207), ...all.slice(13, 25)];
others["run" + more.length]?.(more);
for (let k = 0; k < 3; k++) console.log(attempt(() => count(more)), more.map(node => attempt(() => describe(node))).join(" "), more.map(node => mark(node, 1 << k)).join());
