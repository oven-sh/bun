// Literals that leave out most of what their written type requires stand beside classes that fill it. Reads off the written type speculate on the classes; the literals answer as they are.
interface Node { kind: number; flags: number; pos: number; end: number; parent?: Node; name?: string }
interface Config extends Node { fileName: string; errors: string[] }
interface Missing extends Node { reason: string }
class Identifier implements Node { kind = 1; flags = 0; pos: number; end: number; parent?: Node; name?: string; constructor(pos: number, name: string) { this.pos = pos; this.end = pos + name.length; this.name = name; } }
class Call implements Node { kind = 2; flags = 4; pos: number; end: number; parent?: Node; callee: Node; constructor(callee: Node) { this.pos = callee.pos; this.end = callee.end + 2; this.callee = callee; callee.parent = this; } }
class Block implements Node { kind = 3; flags = 8; pos = 0; end = 0; parent?: Node; statements: Node[]; constructor(statements: Node[]) { this.statements = statements; for (const s of statements) { s.parent = this; this.end = Math.max(this.end, s.end || 0); } } }
class Other0 implements Node { kind = 10; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 0; } }
class Other1 implements Node { kind = 11; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 1; } }
class Other2 implements Node { kind = 12; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 2; } }
class Other3 implements Node { kind = 13; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 3; } }
class Other4 implements Node { kind = 14; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 4; } }
class Other5 implements Node { kind = 15; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 5; } }
class Other6 implements Node { kind = 16; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 6; } }
class Other7 implements Node { kind = 17; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 7; } }
class Other8 implements Node { kind = 18; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 8; } }
class Other9 implements Node { kind = 19; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 9; } }
class Other10 implements Node { kind = 20; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 10; } }
class Other11 implements Node { kind = 21; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 11; } }
class Other12 implements Node { kind = 22; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 12; } }
class Other13 implements Node { kind = 23; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 13; } }
class Other14 implements Node { kind = 24; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 14; } }
class Other15 implements Node { kind = 25; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 15; } }
class Other16 implements Node { kind = 26; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 16; } }
class Other17 implements Node { kind = 27; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 17; } }
class Other18 implements Node { kind = 28; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 18; } }
class Other19 implements Node { kind = 29; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 19; } }
class Other20 implements Node { kind = 30; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 20; } }
class Other21 implements Node { kind = 31; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 21; } }
class Other22 implements Node { kind = 32; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 22; } }
class Other23 implements Node { kind = 33; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 23; } }
class Other24 implements Node { kind = 34; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 24; } }
class Other25 implements Node { kind = 35; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 25; } }
class Other26 implements Node { kind = 36; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 26; } }
class Other27 implements Node { kind = 37; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 27; } }
class Other28 implements Node { kind = 38; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 28; } }
class Other29 implements Node { kind = 39; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 29; } }
class Other30 implements Node { kind = 40; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 30; } }
class Other31 implements Node { kind = 41; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 31; } }
class Other32 implements Node { kind = 42; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 32; } }
class Other33 implements Node { kind = 43; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 33; } }
class Other34 implements Node { kind = 44; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 34; } }
class Other35 implements Node { kind = 45; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 35; } }
class Other36 implements Node { kind = 46; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 36; } }
class Other37 implements Node { kind = 47; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 37; } }
class Other38 implements Node { kind = 48; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 38; } }
class Other39 implements Node { kind = 49; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 39; } }
class Other40 implements Node { kind = 50; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 40; } }
class Other41 implements Node { kind = 51; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 41; } }
class Other42 implements Node { kind = 52; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 42; } }
class Other43 implements Node { kind = 53; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 43; } }
class Other44 implements Node { kind = 54; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 44; } }
class Other45 implements Node { kind = 55; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 45; } }
class Other46 implements Node { kind = 56; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 46; } }
class Other47 implements Node { kind = 57; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 47; } }
class Other48 implements Node { kind = 58; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 48; } }
class Other49 implements Node { kind = 59; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 49; } }
class Other50 implements Node { kind = 60; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 50; } }
class Other51 implements Node { kind = 61; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 51; } }
class Other52 implements Node { kind = 62; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 52; } }
class Other53 implements Node { kind = 63; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 53; } }
class Other54 implements Node { kind = 64; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 54; } }
class Other55 implements Node { kind = 65; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 55; } }
class Other56 implements Node { kind = 66; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 56; } }
class Other57 implements Node { kind = 67; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 57; } }
class Other58 implements Node { kind = 68; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 58; } }
class Other59 implements Node { kind = 69; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 59; } }
class Other60 implements Node { kind = 70; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 60; } }
class Other61 implements Node { kind = 71; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 61; } }
class Other62 implements Node { kind = 72; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 62; } }
class Other63 implements Node { kind = 73; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 63; } }
class Other64 implements Node { kind = 74; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 64; } }
class Other65 implements Node { kind = 75; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 65; } }
class Other66 implements Node { kind = 76; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 66; } }
class Other67 implements Node { kind = 77; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 67; } }
class Other68 implements Node { kind = 78; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 68; } }
class Other69 implements Node { kind = 79; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 69; } }
class Other70 implements Node { kind = 80; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 70; } }
class Other71 implements Node { kind = 81; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 71; } }
class Other72 implements Node { kind = 82; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 72; } }
class Other73 implements Node { kind = 83; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 73; } }
class Other74 implements Node { kind = 84; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 74; } }
class Other75 implements Node { kind = 85; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 75; } }
class Other76 implements Node { kind = 86; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 76; } }
class Other77 implements Node { kind = 87; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 77; } }
class Other78 implements Node { kind = 88; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 78; } }
class Other79 implements Node { kind = 89; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 79; } }
class Other80 implements Node { kind = 90; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 80; } }
class Other81 implements Node { kind = 91; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 81; } }
class Other82 implements Node { kind = 92; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 82; } }
class Other83 implements Node { kind = 93; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 83; } }
class Other84 implements Node { kind = 94; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 84; } }
class Other85 implements Node { kind = 95; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 85; } }
class Other86 implements Node { kind = 96; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 86; } }
class Other87 implements Node { kind = 97; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 87; } }
class Other88 implements Node { kind = 98; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 88; } }
class Other89 implements Node { kind = 99; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 89; } }
class Other90 implements Node { kind = 100; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 90; } }
class Other91 implements Node { kind = 101; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 91; } }
class Other92 implements Node { kind = 102; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 92; } }
class Other93 implements Node { kind = 103; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 93; } }
class Other94 implements Node { kind = 104; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 94; } }
class Other95 implements Node { kind = 105; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 95; } }
class Other96 implements Node { kind = 106; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 96; } }
class Other97 implements Node { kind = 107; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 97; } }
class Other98 implements Node { kind = 108; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 98; } }
class Other99 implements Node { kind = 109; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 99; } }
class Other100 implements Node { kind = 110; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 100; } }
class Other101 implements Node { kind = 111; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 101; } }
class Other102 implements Node { kind = 112; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 102; } }
class Other103 implements Node { kind = 113; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 103; } }
class Other104 implements Node { kind = 114; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 104; } }
class Other105 implements Node { kind = 115; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 105; } }
class Other106 implements Node { kind = 116; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 106; } }
class Other107 implements Node { kind = 117; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 107; } }
class Other108 implements Node { kind = 118; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 108; } }
class Other109 implements Node { kind = 119; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 109; } }
class Other110 implements Node { kind = 120; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 110; } }
class Other111 implements Node { kind = 121; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 111; } }
class Other112 implements Node { kind = 122; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 112; } }
class Other113 implements Node { kind = 123; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 113; } }
class Other114 implements Node { kind = 124; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 114; } }
class Other115 implements Node { kind = 125; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 115; } }
class Other116 implements Node { kind = 126; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 116; } }
class Other117 implements Node { kind = 127; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 117; } }
class Other118 implements Node { kind = 128; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 118; } }
class Other119 implements Node { kind = 129; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 119; } }
class Other120 implements Node { kind = 130; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 120; } }
class Other121 implements Node { kind = 131; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 121; } }
class Other122 implements Node { kind = 132; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 122; } }
class Other123 implements Node { kind = 133; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 123; } }
class Other124 implements Node { kind = 134; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 124; } }
class Other125 implements Node { kind = 135; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 125; } }
class Other126 implements Node { kind = 136; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 126; } }
class Other127 implements Node { kind = 137; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 127; } }
class Other128 implements Node { kind = 138; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 128; } }
class Other129 implements Node { kind = 139; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 129; } }
class Other130 implements Node { kind = 140; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 130; } }
class Other131 implements Node { kind = 141; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 131; } }
class Other132 implements Node { kind = 142; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 132; } }
class Other133 implements Node { kind = 143; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 133; } }
class Other134 implements Node { kind = 144; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 134; } }
class Other135 implements Node { kind = 145; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 135; } }
class Other136 implements Node { kind = 146; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 136; } }
class Other137 implements Node { kind = 147; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 137; } }
class Other138 implements Node { kind = 148; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 138; } }
class Other139 implements Node { kind = 149; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 139; } }
class Other140 implements Node { kind = 150; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 140; } }
class Other141 implements Node { kind = 151; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 141; } }
class Other142 implements Node { kind = 152; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 142; } }
class Other143 implements Node { kind = 153; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 143; } }
class Other144 implements Node { kind = 154; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 144; } }
class Other145 implements Node { kind = 155; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 145; } }
class Other146 implements Node { kind = 156; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 146; } }
class Other147 implements Node { kind = 157; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 147; } }
class Other148 implements Node { kind = 158; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 148; } }
class Other149 implements Node { kind = 159; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 149; } }
class Other150 implements Node { kind = 160; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 150; } }
class Other151 implements Node { kind = 161; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 151; } }
class Other152 implements Node { kind = 162; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 152; } }
class Other153 implements Node { kind = 163; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 153; } }
class Other154 implements Node { kind = 164; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 154; } }
class Other155 implements Node { kind = 165; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 155; } }
class Other156 implements Node { kind = 166; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 156; } }
class Other157 implements Node { kind = 167; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 157; } }
class Other158 implements Node { kind = 168; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 158; } }
class Other159 implements Node { kind = 169; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 159; } }
class Other160 implements Node { kind = 170; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 160; } }
class Other161 implements Node { kind = 171; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 161; } }
class Other162 implements Node { kind = 172; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 162; } }
class Other163 implements Node { kind = 173; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 163; } }
class Other164 implements Node { kind = 174; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 164; } }
class Other165 implements Node { kind = 175; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 165; } }
class Other166 implements Node { kind = 176; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 166; } }
class Other167 implements Node { kind = 177; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 167; } }
class Other168 implements Node { kind = 178; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 168; } }
class Other169 implements Node { kind = 179; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 169; } }
class Other170 implements Node { kind = 180; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 170; } }
class Other171 implements Node { kind = 181; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 171; } }
class Other172 implements Node { kind = 182; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 172; } }
class Other173 implements Node { kind = 183; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 173; } }
class Other174 implements Node { kind = 184; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 174; } }
class Other175 implements Node { kind = 185; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 175; } }
class Other176 implements Node { kind = 186; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 176; } }
class Other177 implements Node { kind = 187; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 177; } }
class Other178 implements Node { kind = 188; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 178; } }
class Other179 implements Node { kind = 189; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 179; } }
class Other180 implements Node { kind = 190; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 180; } }
class Other181 implements Node { kind = 191; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 181; } }
class Other182 implements Node { kind = 192; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 182; } }
class Other183 implements Node { kind = 193; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 183; } }
class Other184 implements Node { kind = 194; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 184; } }
class Other185 implements Node { kind = 195; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 185; } }
class Other186 implements Node { kind = 196; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 186; } }
class Other187 implements Node { kind = 197; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 187; } }
class Other188 implements Node { kind = 198; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 188; } }
class Other189 implements Node { kind = 199; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 189; } }
class Other190 implements Node { kind = 200; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 190; } }
class Other191 implements Node { kind = 201; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 191; } }
class Other192 implements Node { kind = 202; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 192; } }
class Other193 implements Node { kind = 203; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 193; } }
class Other194 implements Node { kind = 204; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 194; } }
class Other195 implements Node { kind = 205; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 195; } }
class Other196 implements Node { kind = 206; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 196; } }
class Other197 implements Node { kind = 207; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 197; } }
class Other198 implements Node { kind = 208; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 198; } }
class Other199 implements Node { kind = 209; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 199; } }
class Other200 implements Node { kind = 210; flags = 1; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 200; } }
class Other201 implements Node { kind = 211; flags = 2; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 201; } }
class Other202 implements Node { kind = 212; flags = 4; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 202; } }
class Other203 implements Node { kind = 213; flags = 8; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 203; } }
class Other204 implements Node { kind = 214; flags = 16; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 204; } }
class Other205 implements Node { kind = 215; flags = 32; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 205; } }
class Other206 implements Node { kind = 216; flags = 64; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 206; } }
class Other207 implements Node { kind = 217; flags = 128; pos: number; end: number; parent?: Node; constructor(pos: number) { this.pos = pos; this.end = pos + 207; } }
function missing(fileName: string, text: string): Config { return { fileName, errors: [text] } as Config; }
function absent(reason: string): Missing { const node = { reason } as Missing; if (reason.length > 4) { node.kind = 9; node.flags = 1; } return node; }
function empty(): Node { return {} as Node; }
const show = (v: unknown): string => JSON.stringify(v, (k, x) => k === "parent" ? "@" : x === undefined ? "@undefined" : typeof x === "number" && !Number.isFinite(x) ? String(x) : x) ?? String(v);
function describe(node: Node): string { return node.kind + ":" + node.flags + ":" + (node.kind & node.flags) + ":" + (node.end - node.pos) + ":" + node.name; }
function count(nodes: Node[]): number { let n = 0; for (const node of nodes) { if (node.kind === 2) n += node.flags; else if (node.flags & 8) n += 100; n += node.parent ? 1 : 0; } return n; }
function mark(node: Node, flags: number): number { node.flags |= flags; return node.flags; }
function depth(node: Node | undefined): number { let d = 0; while (node) { d++; node = node.parent; } return d; }
const others: any = globalThis;
const nodes: Node[] = [];
for (let i = 0; i < 12; i++) nodes.push(new Call(new Identifier(i, "name" + i)));
const all: Node[] = [new Block(nodes), ...nodes, new Other0(1), new Other1(2), new Other2(3), new Other3(4), new Other4(5), new Other5(6), new Other6(7), new Other7(8), missing("a.json", "unread"), absent("none"), absent("reason"), empty()];
others.kept = { all, describe };
others["run" + all.length]?.(all);
const attempt = (f: () => unknown): string => { try { return show(f()); } catch (e) { return (e as Error).constructor.name; } };
for (let k = 0; k < 3; k++) {
  console.log(attempt(() => count(all)));
  for (const node of all) console.log(attempt(() => describe(node)), attempt(() => mark(node, 1 << k)), depth(node), "kind" in node, Object.keys(node).join());
  (all[21] as any).kind = k; (all[24] as any).end = k / 2; delete (all[2] as any).flags;
}
console.log(show(all.slice(21)));
all.push(Object.freeze(missing("b.json", "frozen")), new Proxy(missing("c.json", "proxy"), {}), Object.create(all[0]), { get kind() { return 5; }, flags: 1 } as any, undefined as any, null as any, 5 as any);
for (const node of all.slice(25)) console.log(attempt(() => describe(node)), attempt(() => mark(node, 64)), attempt(() => count([node])));
const more: Node[] = [new Other8(8), new Other9(9), new Other10(10), new Other11(11), new Other12(12), new Other13(13), new Other14(14), new Other15(15), new Other16(16), new Other17(17), new Other18(18), new Other19(19), new Other20(20), new Other21(21), new Other22(22), new Other23(23), new Other24(24), new Other25(25), new Other26(26), new Other27(27), new Other28(28), new Other29(29), new Other30(30), new Other31(31), new Other32(32), new Other33(33), new Other34(34), new Other35(35), new Other36(36), new Other37(37), new Other38(38), new Other39(39), new Other40(40), new Other41(41), new Other42(42), new Other43(43), new Other44(44), new Other45(45), new Other46(46), new Other47(47), new Other48(48), new Other49(49), new Other50(50), new Other51(51), new Other52(52), new Other53(53), new Other54(54), new Other55(55), new Other56(56), new Other57(57), new Other58(58), new Other59(59), new Other60(60), new Other61(61), new Other62(62), new Other63(63), new Other64(64), new Other65(65), new Other66(66), new Other67(67), new Other68(68), new Other69(69), new Other70(70), new Other71(71), new Other72(72), new Other73(73), new Other74(74), new Other75(75), new Other76(76), new Other77(77), new Other78(78), new Other79(79), new Other80(80), new Other81(81), new Other82(82), new Other83(83), new Other84(84), new Other85(85), new Other86(86), new Other87(87), new Other88(88), new Other89(89), new Other90(90), new Other91(91), new Other92(92), new Other93(93), new Other94(94), new Other95(95), new Other96(96), new Other97(97), new Other98(98), new Other99(99), new Other100(100), new Other101(101), new Other102(102), new Other103(103), new Other104(104), new Other105(105), new Other106(106), new Other107(107), new Other108(108), new Other109(109), new Other110(110), new Other111(111), new Other112(112), new Other113(113), new Other114(114), new Other115(115), new Other116(116), new Other117(117), new Other118(118), new Other119(119), new Other120(120), new Other121(121), new Other122(122), new Other123(123), new Other124(124), new Other125(125), new Other126(126), new Other127(127), new Other128(128), new Other129(129), new Other130(130), new Other131(131), new Other132(132), new Other133(133), new Other134(134), new Other135(135), new Other136(136), new Other137(137), new Other138(138), new Other139(139), new Other140(140), new Other141(141), new Other142(142), new Other143(143), new Other144(144), new Other145(145), new Other146(146), new Other147(147), new Other148(148), new Other149(149), new Other150(150), new Other151(151), new Other152(152), new Other153(153), new Other154(154), new Other155(155), new Other156(156), new Other157(157), new Other158(158), new Other159(159), new Other160(160), new Other161(161), new Other162(162), new Other163(163), new Other164(164), new Other165(165), new Other166(166), new Other167(167), new Other168(168), new Other169(169), new Other170(170), new Other171(171), new Other172(172), new Other173(173), new Other174(174), new Other175(175), new Other176(176), new Other177(177), new Other178(178), new Other179(179), new Other180(180), new Other181(181), new Other182(182), new Other183(183), new Other184(184), new Other185(185), new Other186(186), new Other187(187), new Other188(188), new Other189(189), new Other190(190), new Other191(191), new Other192(192), new Other193(193), new Other194(194), new Other195(195), new Other196(196), new Other197(197), new Other198(198), new Other199(199), new Other200(200), new Other201(201), new Other202(202), new Other203(203), new Other204(204), new Other205(205), new Other206(206), new Other207(207), ...all.slice(13, 25)];
others["run" + more.length]?.(more);
for (let k = 0; k < 3; k++) console.log(attempt(() => count(more)), more.map(node => attempt(() => describe(node))).join(" "), more.map(node => mark(node, 1 << k)).join());
