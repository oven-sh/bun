// Alone: the analysis goes another way where it evaluates few nodes again and again, and beside other programs their nodes are counted too
// Each function is given an instance of a class of its own and hands what it is given to the function before it, so the first is given an instance of any class.
let sum = 0;
class Kind0 { weigh() { return 1; } }
function ask0(x) { return x.weigh(); }
sum += ask0(new Kind0());
class Kind1 { weigh() { return 4; } }
function ask1(x) { return x.weigh() + ask0(x); }
sum += ask1(new Kind1());
class Kind2 { weigh() { return 7; } }
function ask2(x) { return x.weigh() + ask1(x); }
sum += ask2(new Kind2());
class Kind3 { weigh() { return 10; } }
function ask3(x) { return x.weigh() + ask2(x); }
sum += ask3(new Kind3());
class Kind4 { weigh() { return 13; } }
function ask4(x) { return x.weigh() + ask3(x); }
sum += ask4(new Kind4());
class Kind5 { weigh() { return 16; } }
function ask5(x) { return x.weigh() + ask4(x); }
sum += ask5(new Kind5());
class Kind6 { weigh() { return 19; } }
function ask6(x) { return x.weigh() + ask5(x); }
sum += ask6(new Kind6());
class Kind7 { weigh() { return 22; } }
function ask7(x) { return x.weigh() + ask6(x); }
sum += ask7(new Kind7());
class Kind8 { weigh() { return 25; } }
function ask8(x) { return x.weigh() + ask7(x); }
sum += ask8(new Kind8());
class Kind9 { weigh() { return 28; } }
function ask9(x) { return x.weigh() + ask8(x); }
sum += ask9(new Kind9());
class Kind10 { weigh() { return 31; } }
function ask10(x) { return x.weigh() + ask9(x); }
sum += ask10(new Kind10());
class Kind11 { weigh() { return 34; } }
function ask11(x) { return x.weigh() + ask10(x); }
sum += ask11(new Kind11());
class Kind12 { weigh() { return 37; } }
function ask12(x) { return x.weigh() + ask11(x); }
sum += ask12(new Kind12());
class Kind13 { weigh() { return 40; } }
function ask13(x) { return x.weigh() + ask12(x); }
sum += ask13(new Kind13());
class Kind14 { weigh() { return 43; } }
function ask14(x) { return x.weigh() + ask13(x); }
sum += ask14(new Kind14());
class Kind15 { weigh() { return 46; } }
function ask15(x) { return x.weigh() + ask14(x); }
sum += ask15(new Kind15());
class Kind16 { weigh() { return 49; } }
function ask16(x) { return x.weigh() + ask15(x); }
sum += ask16(new Kind16());
class Kind17 { weigh() { return 52; } }
function ask17(x) { return x.weigh() + ask16(x); }
sum += ask17(new Kind17());
class Kind18 { weigh() { return 55; } }
function ask18(x) { return x.weigh() + ask17(x); }
sum += ask18(new Kind18());
class Kind19 { weigh() { return 58; } }
function ask19(x) { return x.weigh() + ask18(x); }
sum += ask19(new Kind19());
class Kind20 { weigh() { return 61; } }
function ask20(x) { return x.weigh() + ask19(x); }
sum += ask20(new Kind20());
class Kind21 { weigh() { return 64; } }
function ask21(x) { return x.weigh() + ask20(x); }
sum += ask21(new Kind21());
class Kind22 { weigh() { return 67; } }
function ask22(x) { return x.weigh() + ask21(x); }
sum += ask22(new Kind22());
class Kind23 { weigh() { return 70; } }
function ask23(x) { return x.weigh() + ask22(x); }
sum += ask23(new Kind23());
class Kind24 { weigh() { return 73; } }
function ask24(x) { return x.weigh() + ask23(x); }
sum += ask24(new Kind24());
class Kind25 { weigh() { return 76; } }
function ask25(x) { return x.weigh() + ask24(x); }
sum += ask25(new Kind25());
class Kind26 { weigh() { return 79; } }
function ask26(x) { return x.weigh() + ask25(x); }
sum += ask26(new Kind26());
class Kind27 { weigh() { return 82; } }
function ask27(x) { return x.weigh() + ask26(x); }
sum += ask27(new Kind27());
class Kind28 { weigh() { return 85; } }
function ask28(x) { return x.weigh() + ask27(x); }
sum += ask28(new Kind28());
class Kind29 { weigh() { return 88; } }
function ask29(x) { return x.weigh() + ask28(x); }
sum += ask29(new Kind29());
class Kind30 { weigh() { return 91; } }
function ask30(x) { return x.weigh() + ask29(x); }
sum += ask30(new Kind30());
class Kind31 { weigh() { return 94; } }
function ask31(x) { return x.weigh() + ask30(x); }
sum += ask31(new Kind31());
class Kind32 { weigh() { return 97; } }
function ask32(x) { return x.weigh() + ask31(x); }
sum += ask32(new Kind32());
class Kind33 { weigh() { return 100; } }
function ask33(x) { return x.weigh() + ask32(x); }
sum += ask33(new Kind33());
class Kind34 { weigh() { return 103; } }
function ask34(x) { return x.weigh() + ask33(x); }
sum += ask34(new Kind34());
class Kind35 { weigh() { return 106; } }
function ask35(x) { return x.weigh() + ask34(x); }
sum += ask35(new Kind35());
class Kind36 { weigh() { return 109; } }
function ask36(x) { return x.weigh() + ask35(x); }
sum += ask36(new Kind36());
class Kind37 { weigh() { return 112; } }
function ask37(x) { return x.weigh() + ask36(x); }
sum += ask37(new Kind37());
class Kind38 { weigh() { return 115; } }
function ask38(x) { return x.weigh() + ask37(x); }
sum += ask38(new Kind38());
class Kind39 { weigh() { return 118; } }
function ask39(x) { return x.weigh() + ask38(x); }
sum += ask39(new Kind39());
class Kind40 { weigh() { return 121; } }
function ask40(x) { return x.weigh() + ask39(x); }
sum += ask40(new Kind40());
class Kind41 { weigh() { return 124; } }
function ask41(x) { return x.weigh() + ask40(x); }
sum += ask41(new Kind41());
class Kind42 { weigh() { return 127; } }
function ask42(x) { return x.weigh() + ask41(x); }
sum += ask42(new Kind42());
class Kind43 { weigh() { return 130; } }
function ask43(x) { return x.weigh() + ask42(x); }
sum += ask43(new Kind43());
class Kind44 { weigh() { return 133; } }
function ask44(x) { return x.weigh() + ask43(x); }
sum += ask44(new Kind44());
class Kind45 { weigh() { return 136; } }
function ask45(x) { return x.weigh() + ask44(x); }
sum += ask45(new Kind45());
class Kind46 { weigh() { return 139; } }
function ask46(x) { return x.weigh() + ask45(x); }
sum += ask46(new Kind46());
class Kind47 { weigh() { return 142; } }
function ask47(x) { return x.weigh() + ask46(x); }
sum += ask47(new Kind47());
class Kind48 { weigh() { return 145; } }
function ask48(x) { return x.weigh() + ask47(x); }
sum += ask48(new Kind48());
class Kind49 { weigh() { return 148; } }
function ask49(x) { return x.weigh() + ask48(x); }
sum += ask49(new Kind49());
class Kind50 { weigh() { return 151; } }
function ask50(x) { return x.weigh() + ask49(x); }
sum += ask50(new Kind50());
class Kind51 { weigh() { return 154; } }
function ask51(x) { return x.weigh() + ask50(x); }
sum += ask51(new Kind51());
class Kind52 { weigh() { return 157; } }
function ask52(x) { return x.weigh() + ask51(x); }
sum += ask52(new Kind52());
class Kind53 { weigh() { return 160; } }
function ask53(x) { return x.weigh() + ask52(x); }
sum += ask53(new Kind53());
class Kind54 { weigh() { return 163; } }
function ask54(x) { return x.weigh() + ask53(x); }
sum += ask54(new Kind54());
class Kind55 { weigh() { return 166; } }
function ask55(x) { return x.weigh() + ask54(x); }
sum += ask55(new Kind55());
class Kind56 { weigh() { return 169; } }
function ask56(x) { return x.weigh() + ask55(x); }
sum += ask56(new Kind56());
class Kind57 { weigh() { return 172; } }
function ask57(x) { return x.weigh() + ask56(x); }
sum += ask57(new Kind57());
class Kind58 { weigh() { return 175; } }
function ask58(x) { return x.weigh() + ask57(x); }
sum += ask58(new Kind58());
class Kind59 { weigh() { return 178; } }
function ask59(x) { return x.weigh() + ask58(x); }
sum += ask59(new Kind59());
class Kind60 { weigh() { return 181; } }
function ask60(x) { return x.weigh() + ask59(x); }
sum += ask60(new Kind60());
class Kind61 { weigh() { return 184; } }
function ask61(x) { return x.weigh() + ask60(x); }
sum += ask61(new Kind61());
class Kind62 { weigh() { return 187; } }
function ask62(x) { return x.weigh() + ask61(x); }
sum += ask62(new Kind62());
class Kind63 { weigh() { return 190; } }
function ask63(x) { return x.weigh() + ask62(x); }
sum += ask63(new Kind63());
class Kind64 { weigh() { return 193; } }
function ask64(x) { return x.weigh() + ask63(x); }
sum += ask64(new Kind64());
class Kind65 { weigh() { return 196; } }
function ask65(x) { return x.weigh() + ask64(x); }
sum += ask65(new Kind65());
class Kind66 { weigh() { return 199; } }
function ask66(x) { return x.weigh() + ask65(x); }
sum += ask66(new Kind66());
class Kind67 { weigh() { return 202; } }
function ask67(x) { return x.weigh() + ask66(x); }
sum += ask67(new Kind67());
class Kind68 { weigh() { return 205; } }
function ask68(x) { return x.weigh() + ask67(x); }
sum += ask68(new Kind68());
class Kind69 { weigh() { return 208; } }
function ask69(x) { return x.weigh() + ask68(x); }
sum += ask69(new Kind69());
class Kind70 { weigh() { return 211; } }
function ask70(x) { return x.weigh() + ask69(x); }
sum += ask70(new Kind70());
class Kind71 { weigh() { return 214; } }
function ask71(x) { return x.weigh() + ask70(x); }
sum += ask71(new Kind71());
class Kind72 { weigh() { return 217; } }
function ask72(x) { return x.weigh() + ask71(x); }
sum += ask72(new Kind72());
class Kind73 { weigh() { return 220; } }
function ask73(x) { return x.weigh() + ask72(x); }
sum += ask73(new Kind73());
class Kind74 { weigh() { return 223; } }
function ask74(x) { return x.weigh() + ask73(x); }
sum += ask74(new Kind74());
class Kind75 { weigh() { return 226; } }
function ask75(x) { return x.weigh() + ask74(x); }
sum += ask75(new Kind75());
class Kind76 { weigh() { return 229; } }
function ask76(x) { return x.weigh() + ask75(x); }
sum += ask76(new Kind76());
class Kind77 { weigh() { return 232; } }
function ask77(x) { return x.weigh() + ask76(x); }
sum += ask77(new Kind77());
class Kind78 { weigh() { return 235; } }
function ask78(x) { return x.weigh() + ask77(x); }
sum += ask78(new Kind78());
class Kind79 { weigh() { return 238; } }
function ask79(x) { return x.weigh() + ask78(x); }
sum += ask79(new Kind79());
class Kind80 { weigh() { return 241; } }
function ask80(x) { return x.weigh() + ask79(x); }
sum += ask80(new Kind80());
class Kind81 { weigh() { return 244; } }
function ask81(x) { return x.weigh() + ask80(x); }
sum += ask81(new Kind81());
class Kind82 { weigh() { return 247; } }
function ask82(x) { return x.weigh() + ask81(x); }
sum += ask82(new Kind82());
class Kind83 { weigh() { return 250; } }
function ask83(x) { return x.weigh() + ask82(x); }
sum += ask83(new Kind83());
class Kind84 { weigh() { return 253; } }
function ask84(x) { return x.weigh() + ask83(x); }
sum += ask84(new Kind84());
class Kind85 { weigh() { return 256; } }
function ask85(x) { return x.weigh() + ask84(x); }
sum += ask85(new Kind85());
class Kind86 { weigh() { return 259; } }
function ask86(x) { return x.weigh() + ask85(x); }
sum += ask86(new Kind86());
class Kind87 { weigh() { return 262; } }
function ask87(x) { return x.weigh() + ask86(x); }
sum += ask87(new Kind87());
class Kind88 { weigh() { return 265; } }
function ask88(x) { return x.weigh() + ask87(x); }
sum += ask88(new Kind88());
class Kind89 { weigh() { return 268; } }
function ask89(x) { return x.weigh() + ask88(x); }
sum += ask89(new Kind89());
class Kind90 { weigh() { return 271; } }
function ask90(x) { return x.weigh() + ask89(x); }
sum += ask90(new Kind90());
class Kind91 { weigh() { return 274; } }
function ask91(x) { return x.weigh() + ask90(x); }
sum += ask91(new Kind91());
class Kind92 { weigh() { return 277; } }
function ask92(x) { return x.weigh() + ask91(x); }
sum += ask92(new Kind92());
class Kind93 { weigh() { return 280; } }
function ask93(x) { return x.weigh() + ask92(x); }
sum += ask93(new Kind93());
class Kind94 { weigh() { return 283; } }
function ask94(x) { return x.weigh() + ask93(x); }
sum += ask94(new Kind94());
class Kind95 { weigh() { return 286; } }
function ask95(x) { return x.weigh() + ask94(x); }
sum += ask95(new Kind95());
class Kind96 { weigh() { return 289; } }
function ask96(x) { return x.weigh() + ask95(x); }
sum += ask96(new Kind96());
class Kind97 { weigh() { return 292; } }
function ask97(x) { return x.weigh() + ask96(x); }
sum += ask97(new Kind97());
class Kind98 { weigh() { return 295; } }
function ask98(x) { return x.weigh() + ask97(x); }
sum += ask98(new Kind98());
class Kind99 { weigh() { return 298; } }
function ask99(x) { return x.weigh() + ask98(x); }
sum += ask99(new Kind99());
class Kind100 { weigh() { return 301; } }
function ask100(x) { return x.weigh() + ask99(x); }
sum += ask100(new Kind100());
class Kind101 { weigh() { return 304; } }
function ask101(x) { return x.weigh() + ask100(x); }
sum += ask101(new Kind101());
class Kind102 { weigh() { return 307; } }
function ask102(x) { return x.weigh() + ask101(x); }
sum += ask102(new Kind102());
class Kind103 { weigh() { return 310; } }
function ask103(x) { return x.weigh() + ask102(x); }
sum += ask103(new Kind103());
class Kind104 { weigh() { return 313; } }
function ask104(x) { return x.weigh() + ask103(x); }
sum += ask104(new Kind104());
class Kind105 { weigh() { return 316; } }
function ask105(x) { return x.weigh() + ask104(x); }
sum += ask105(new Kind105());
class Kind106 { weigh() { return 319; } }
function ask106(x) { return x.weigh() + ask105(x); }
sum += ask106(new Kind106());
class Kind107 { weigh() { return 322; } }
function ask107(x) { return x.weigh() + ask106(x); }
sum += ask107(new Kind107());
class Kind108 { weigh() { return 325; } }
function ask108(x) { return x.weigh() + ask107(x); }
sum += ask108(new Kind108());
class Kind109 { weigh() { return 328; } }
function ask109(x) { return x.weigh() + ask108(x); }
sum += ask109(new Kind109());
class Kind110 { weigh() { return 331; } }
function ask110(x) { return x.weigh() + ask109(x); }
sum += ask110(new Kind110());
class Kind111 { weigh() { return 334; } }
function ask111(x) { return x.weigh() + ask110(x); }
sum += ask111(new Kind111());
class Kind112 { weigh() { return 337; } }
function ask112(x) { return x.weigh() + ask111(x); }
sum += ask112(new Kind112());
class Kind113 { weigh() { return 340; } }
function ask113(x) { return x.weigh() + ask112(x); }
sum += ask113(new Kind113());
class Kind114 { weigh() { return 343; } }
function ask114(x) { return x.weigh() + ask113(x); }
sum += ask114(new Kind114());
class Kind115 { weigh() { return 346; } }
function ask115(x) { return x.weigh() + ask114(x); }
sum += ask115(new Kind115());
class Kind116 { weigh() { return 349; } }
function ask116(x) { return x.weigh() + ask115(x); }
sum += ask116(new Kind116());
class Kind117 { weigh() { return 352; } }
function ask117(x) { return x.weigh() + ask116(x); }
sum += ask117(new Kind117());
class Kind118 { weigh() { return 355; } }
function ask118(x) { return x.weigh() + ask117(x); }
sum += ask118(new Kind118());
class Kind119 { weigh() { return 358; } }
function ask119(x) { return x.weigh() + ask118(x); }
sum += ask119(new Kind119());
class Kind120 { weigh() { return 361; } }
function ask120(x) { return x.weigh() + ask119(x); }
sum += ask120(new Kind120());
class Kind121 { weigh() { return 364; } }
function ask121(x) { return x.weigh() + ask120(x); }
sum += ask121(new Kind121());
class Kind122 { weigh() { return 367; } }
function ask122(x) { return x.weigh() + ask121(x); }
sum += ask122(new Kind122());
class Kind123 { weigh() { return 370; } }
function ask123(x) { return x.weigh() + ask122(x); }
sum += ask123(new Kind123());
class Kind124 { weigh() { return 373; } }
function ask124(x) { return x.weigh() + ask123(x); }
sum += ask124(new Kind124());
class Kind125 { weigh() { return 376; } }
function ask125(x) { return x.weigh() + ask124(x); }
sum += ask125(new Kind125());
class Kind126 { weigh() { return 379; } }
function ask126(x) { return x.weigh() + ask125(x); }
sum += ask126(new Kind126());
class Kind127 { weigh() { return 382; } }
function ask127(x) { return x.weigh() + ask126(x); }
sum += ask127(new Kind127());
class Kind128 { weigh() { return 385; } }
function ask128(x) { return x.weigh() + ask127(x); }
sum += ask128(new Kind128());
class Kind129 { weigh() { return 388; } }
function ask129(x) { return x.weigh() + ask128(x); }
sum += ask129(new Kind129());
class Kind130 { weigh() { return 391; } }
function ask130(x) { return x.weigh() + ask129(x); }
sum += ask130(new Kind130());
class Kind131 { weigh() { return 394; } }
function ask131(x) { return x.weigh() + ask130(x); }
sum += ask131(new Kind131());
class Kind132 { weigh() { return 397; } }
function ask132(x) { return x.weigh() + ask131(x); }
sum += ask132(new Kind132());
class Kind133 { weigh() { return 400; } }
function ask133(x) { return x.weigh() + ask132(x); }
sum += ask133(new Kind133());
class Kind134 { weigh() { return 403; } }
function ask134(x) { return x.weigh() + ask133(x); }
sum += ask134(new Kind134());
class Kind135 { weigh() { return 406; } }
function ask135(x) { return x.weigh() + ask134(x); }
sum += ask135(new Kind135());
class Kind136 { weigh() { return 409; } }
function ask136(x) { return x.weigh() + ask135(x); }
sum += ask136(new Kind136());
class Kind137 { weigh() { return 412; } }
function ask137(x) { return x.weigh() + ask136(x); }
sum += ask137(new Kind137());
class Kind138 { weigh() { return 415; } }
function ask138(x) { return x.weigh() + ask137(x); }
sum += ask138(new Kind138());
class Kind139 { weigh() { return 418; } }
function ask139(x) { return x.weigh() + ask138(x); }
sum += ask139(new Kind139());
console.log(sum, ask0(new Kind139()), ask139(new Kind0()), ask7(new Kind70()));
