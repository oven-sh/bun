// Three hundred pairs of classes, the second of each below the first, are defined; nothing has touched them where they are counted. What is counted lies in the collector's heap.
// The count itself leaves up to 80 structures and 180 objects behind, so the bounds stand well above one and well below two a pair.
// The expected text is that of compiled code: an engine that defines a class at once makes two objects and several structures for each.
// Prints what the compiler saves: structures and prototype objects of classes that are only defined
import { heapStats } from "bun:jsc";
function count(): [number, number] {
  const counts = heapStats().objectTypeCounts as Record<string, number>;
  return [counts.Structure ?? 0, counts.Object ?? 0];
}
// prettier-ignore
const makers: (() => number)[] = [
  () => new B0().n(), () => new B1().n(), () => new B2().n(), () => new B3().n(), () => new B4().n(), () => new B5().n(), () => new B6().n(), () => new B7().n(), () => new B8().n(), () => new B9().n(),
  () => new B10().n(), () => new B11().n(), () => new B12().n(), () => new B13().n(), () => new B14().n(), () => new B15().n(), () => new B16().n(), () => new B17().n(), () => new B18().n(), () => new B19().n(),
  () => new B20().n(), () => new B21().n(), () => new B22().n(), () => new B23().n(), () => new B24().n(), () => new B25().n(), () => new B26().n(), () => new B27().n(), () => new B28().n(), () => new B29().n(),
  () => new B30().n(), () => new B31().n(), () => new B32().n(), () => new B33().n(), () => new B34().n(), () => new B35().n(), () => new B36().n(), () => new B37().n(), () => new B38().n(), () => new B39().n(),
  () => new B40().n(), () => new B41().n(), () => new B42().n(), () => new B43().n(), () => new B44().n(), () => new B45().n(), () => new B46().n(), () => new B47().n(), () => new B48().n(), () => new B49().n(),
  () => new B50().n(), () => new B51().n(), () => new B52().n(), () => new B53().n(), () => new B54().n(), () => new B55().n(), () => new B56().n(), () => new B57().n(), () => new B58().n(), () => new B59().n(),
  () => new B60().n(), () => new B61().n(), () => new B62().n(), () => new B63().n(), () => new B64().n(), () => new B65().n(), () => new B66().n(), () => new B67().n(), () => new B68().n(), () => new B69().n(),
  () => new B70().n(), () => new B71().n(), () => new B72().n(), () => new B73().n(), () => new B74().n(), () => new B75().n(), () => new B76().n(), () => new B77().n(), () => new B78().n(), () => new B79().n(),
  () => new B80().n(), () => new B81().n(), () => new B82().n(), () => new B83().n(), () => new B84().n(), () => new B85().n(), () => new B86().n(), () => new B87().n(), () => new B88().n(), () => new B89().n(),
  () => new B90().n(), () => new B91().n(), () => new B92().n(), () => new B93().n(), () => new B94().n(), () => new B95().n(), () => new B96().n(), () => new B97().n(), () => new B98().n(), () => new B99().n(),
  () => new B100().n(), () => new B101().n(), () => new B102().n(), () => new B103().n(), () => new B104().n(), () => new B105().n(), () => new B106().n(), () => new B107().n(), () => new B108().n(), () => new B109().n(),
  () => new B110().n(), () => new B111().n(), () => new B112().n(), () => new B113().n(), () => new B114().n(), () => new B115().n(), () => new B116().n(), () => new B117().n(), () => new B118().n(), () => new B119().n(),
  () => new B120().n(), () => new B121().n(), () => new B122().n(), () => new B123().n(), () => new B124().n(), () => new B125().n(), () => new B126().n(), () => new B127().n(), () => new B128().n(), () => new B129().n(),
  () => new B130().n(), () => new B131().n(), () => new B132().n(), () => new B133().n(), () => new B134().n(), () => new B135().n(), () => new B136().n(), () => new B137().n(), () => new B138().n(), () => new B139().n(),
  () => new B140().n(), () => new B141().n(), () => new B142().n(), () => new B143().n(), () => new B144().n(), () => new B145().n(), () => new B146().n(), () => new B147().n(), () => new B148().n(), () => new B149().n(),
  () => new B150().n(), () => new B151().n(), () => new B152().n(), () => new B153().n(), () => new B154().n(), () => new B155().n(), () => new B156().n(), () => new B157().n(), () => new B158().n(), () => new B159().n(),
  () => new B160().n(), () => new B161().n(), () => new B162().n(), () => new B163().n(), () => new B164().n(), () => new B165().n(), () => new B166().n(), () => new B167().n(), () => new B168().n(), () => new B169().n(),
  () => new B170().n(), () => new B171().n(), () => new B172().n(), () => new B173().n(), () => new B174().n(), () => new B175().n(), () => new B176().n(), () => new B177().n(), () => new B178().n(), () => new B179().n(),
  () => new B180().n(), () => new B181().n(), () => new B182().n(), () => new B183().n(), () => new B184().n(), () => new B185().n(), () => new B186().n(), () => new B187().n(), () => new B188().n(), () => new B189().n(),
  () => new B190().n(), () => new B191().n(), () => new B192().n(), () => new B193().n(), () => new B194().n(), () => new B195().n(), () => new B196().n(), () => new B197().n(), () => new B198().n(), () => new B199().n(),
  () => new B200().n(), () => new B201().n(), () => new B202().n(), () => new B203().n(), () => new B204().n(), () => new B205().n(), () => new B206().n(), () => new B207().n(), () => new B208().n(), () => new B209().n(),
  () => new B210().n(), () => new B211().n(), () => new B212().n(), () => new B213().n(), () => new B214().n(), () => new B215().n(), () => new B216().n(), () => new B217().n(), () => new B218().n(), () => new B219().n(),
  () => new B220().n(), () => new B221().n(), () => new B222().n(), () => new B223().n(), () => new B224().n(), () => new B225().n(), () => new B226().n(), () => new B227().n(), () => new B228().n(), () => new B229().n(),
  () => new B230().n(), () => new B231().n(), () => new B232().n(), () => new B233().n(), () => new B234().n(), () => new B235().n(), () => new B236().n(), () => new B237().n(), () => new B238().n(), () => new B239().n(),
  () => new B240().n(), () => new B241().n(), () => new B242().n(), () => new B243().n(), () => new B244().n(), () => new B245().n(), () => new B246().n(), () => new B247().n(), () => new B248().n(), () => new B249().n(),
  () => new B250().n(), () => new B251().n(), () => new B252().n(), () => new B253().n(), () => new B254().n(), () => new B255().n(), () => new B256().n(), () => new B257().n(), () => new B258().n(), () => new B259().n(),
  () => new B260().n(), () => new B261().n(), () => new B262().n(), () => new B263().n(), () => new B264().n(), () => new B265().n(), () => new B266().n(), () => new B267().n(), () => new B268().n(), () => new B269().n(),
  () => new B270().n(), () => new B271().n(), () => new B272().n(), () => new B273().n(), () => new B274().n(), () => new B275().n(), () => new B276().n(), () => new B277().n(), () => new B278().n(), () => new B279().n(),
  () => new B280().n(), () => new B281().n(), () => new B282().n(), () => new B283().n(), () => new B284().n(), () => new B285().n(), () => new B286().n(), () => new B287().n(), () => new B288().n(), () => new B289().n(),
  () => new B290().n(), () => new B291().n(), () => new B292().n(), () => new B293().n(), () => new B294().n(), () => new B295().n(), () => new B296().n(), () => new B297().n(), () => new B298().n(), () => new B299().n(),
];
count();
count();
const before = count();
// prettier-ignore
class A0 { m() { return 0; } } class B0 extends A0 { n() { return this.m(); } } class A1 { m() { return 1; } } class B1 extends A1 { n() { return this.m(); } } class A2 { m() { return 2; } } class B2 extends A2 { n() { return this.m(); } }
// prettier-ignore
class A3 { m() { return 3; } } class B3 extends A3 { n() { return this.m(); } } class A4 { m() { return 4; } } class B4 extends A4 { n() { return this.m(); } } class A5 { m() { return 5; } } class B5 extends A5 { n() { return this.m(); } }
// prettier-ignore
class A6 { m() { return 6; } } class B6 extends A6 { n() { return this.m(); } } class A7 { m() { return 7; } } class B7 extends A7 { n() { return this.m(); } } class A8 { m() { return 8; } } class B8 extends A8 { n() { return this.m(); } }
// prettier-ignore
class A9 { m() { return 9; } } class B9 extends A9 { n() { return this.m(); } } class A10 { m() { return 10; } } class B10 extends A10 { n() { return this.m(); } } class A11 { m() { return 11; } } class B11 extends A11 { n() { return this.m(); } }
// prettier-ignore
class A12 { m() { return 12; } } class B12 extends A12 { n() { return this.m(); } } class A13 { m() { return 13; } } class B13 extends A13 { n() { return this.m(); } } class A14 { m() { return 14; } } class B14 extends A14 { n() { return this.m(); } }
// prettier-ignore
class A15 { m() { return 15; } } class B15 extends A15 { n() { return this.m(); } } class A16 { m() { return 16; } } class B16 extends A16 { n() { return this.m(); } } class A17 { m() { return 17; } } class B17 extends A17 { n() { return this.m(); } }
// prettier-ignore
class A18 { m() { return 18; } } class B18 extends A18 { n() { return this.m(); } } class A19 { m() { return 19; } } class B19 extends A19 { n() { return this.m(); } } class A20 { m() { return 20; } } class B20 extends A20 { n() { return this.m(); } }
// prettier-ignore
class A21 { m() { return 21; } } class B21 extends A21 { n() { return this.m(); } } class A22 { m() { return 22; } } class B22 extends A22 { n() { return this.m(); } } class A23 { m() { return 23; } } class B23 extends A23 { n() { return this.m(); } }
// prettier-ignore
class A24 { m() { return 24; } } class B24 extends A24 { n() { return this.m(); } } class A25 { m() { return 25; } } class B25 extends A25 { n() { return this.m(); } } class A26 { m() { return 26; } } class B26 extends A26 { n() { return this.m(); } }
// prettier-ignore
class A27 { m() { return 27; } } class B27 extends A27 { n() { return this.m(); } } class A28 { m() { return 28; } } class B28 extends A28 { n() { return this.m(); } } class A29 { m() { return 29; } } class B29 extends A29 { n() { return this.m(); } }
// prettier-ignore
class A30 { m() { return 30; } } class B30 extends A30 { n() { return this.m(); } } class A31 { m() { return 31; } } class B31 extends A31 { n() { return this.m(); } } class A32 { m() { return 32; } } class B32 extends A32 { n() { return this.m(); } }
// prettier-ignore
class A33 { m() { return 33; } } class B33 extends A33 { n() { return this.m(); } } class A34 { m() { return 34; } } class B34 extends A34 { n() { return this.m(); } } class A35 { m() { return 35; } } class B35 extends A35 { n() { return this.m(); } }
// prettier-ignore
class A36 { m() { return 36; } } class B36 extends A36 { n() { return this.m(); } } class A37 { m() { return 37; } } class B37 extends A37 { n() { return this.m(); } } class A38 { m() { return 38; } } class B38 extends A38 { n() { return this.m(); } }
// prettier-ignore
class A39 { m() { return 39; } } class B39 extends A39 { n() { return this.m(); } } class A40 { m() { return 40; } } class B40 extends A40 { n() { return this.m(); } } class A41 { m() { return 41; } } class B41 extends A41 { n() { return this.m(); } }
// prettier-ignore
class A42 { m() { return 42; } } class B42 extends A42 { n() { return this.m(); } } class A43 { m() { return 43; } } class B43 extends A43 { n() { return this.m(); } } class A44 { m() { return 44; } } class B44 extends A44 { n() { return this.m(); } }
// prettier-ignore
class A45 { m() { return 45; } } class B45 extends A45 { n() { return this.m(); } } class A46 { m() { return 46; } } class B46 extends A46 { n() { return this.m(); } } class A47 { m() { return 47; } } class B47 extends A47 { n() { return this.m(); } }
// prettier-ignore
class A48 { m() { return 48; } } class B48 extends A48 { n() { return this.m(); } } class A49 { m() { return 49; } } class B49 extends A49 { n() { return this.m(); } } class A50 { m() { return 50; } } class B50 extends A50 { n() { return this.m(); } }
// prettier-ignore
class A51 { m() { return 51; } } class B51 extends A51 { n() { return this.m(); } } class A52 { m() { return 52; } } class B52 extends A52 { n() { return this.m(); } } class A53 { m() { return 53; } } class B53 extends A53 { n() { return this.m(); } }
// prettier-ignore
class A54 { m() { return 54; } } class B54 extends A54 { n() { return this.m(); } } class A55 { m() { return 55; } } class B55 extends A55 { n() { return this.m(); } } class A56 { m() { return 56; } } class B56 extends A56 { n() { return this.m(); } }
// prettier-ignore
class A57 { m() { return 57; } } class B57 extends A57 { n() { return this.m(); } } class A58 { m() { return 58; } } class B58 extends A58 { n() { return this.m(); } } class A59 { m() { return 59; } } class B59 extends A59 { n() { return this.m(); } }
// prettier-ignore
class A60 { m() { return 60; } } class B60 extends A60 { n() { return this.m(); } } class A61 { m() { return 61; } } class B61 extends A61 { n() { return this.m(); } } class A62 { m() { return 62; } } class B62 extends A62 { n() { return this.m(); } }
// prettier-ignore
class A63 { m() { return 63; } } class B63 extends A63 { n() { return this.m(); } } class A64 { m() { return 64; } } class B64 extends A64 { n() { return this.m(); } } class A65 { m() { return 65; } } class B65 extends A65 { n() { return this.m(); } }
// prettier-ignore
class A66 { m() { return 66; } } class B66 extends A66 { n() { return this.m(); } } class A67 { m() { return 67; } } class B67 extends A67 { n() { return this.m(); } } class A68 { m() { return 68; } } class B68 extends A68 { n() { return this.m(); } }
// prettier-ignore
class A69 { m() { return 69; } } class B69 extends A69 { n() { return this.m(); } } class A70 { m() { return 70; } } class B70 extends A70 { n() { return this.m(); } } class A71 { m() { return 71; } } class B71 extends A71 { n() { return this.m(); } }
// prettier-ignore
class A72 { m() { return 72; } } class B72 extends A72 { n() { return this.m(); } } class A73 { m() { return 73; } } class B73 extends A73 { n() { return this.m(); } } class A74 { m() { return 74; } } class B74 extends A74 { n() { return this.m(); } }
// prettier-ignore
class A75 { m() { return 75; } } class B75 extends A75 { n() { return this.m(); } } class A76 { m() { return 76; } } class B76 extends A76 { n() { return this.m(); } } class A77 { m() { return 77; } } class B77 extends A77 { n() { return this.m(); } }
// prettier-ignore
class A78 { m() { return 78; } } class B78 extends A78 { n() { return this.m(); } } class A79 { m() { return 79; } } class B79 extends A79 { n() { return this.m(); } } class A80 { m() { return 80; } } class B80 extends A80 { n() { return this.m(); } }
// prettier-ignore
class A81 { m() { return 81; } } class B81 extends A81 { n() { return this.m(); } } class A82 { m() { return 82; } } class B82 extends A82 { n() { return this.m(); } } class A83 { m() { return 83; } } class B83 extends A83 { n() { return this.m(); } }
// prettier-ignore
class A84 { m() { return 84; } } class B84 extends A84 { n() { return this.m(); } } class A85 { m() { return 85; } } class B85 extends A85 { n() { return this.m(); } } class A86 { m() { return 86; } } class B86 extends A86 { n() { return this.m(); } }
// prettier-ignore
class A87 { m() { return 87; } } class B87 extends A87 { n() { return this.m(); } } class A88 { m() { return 88; } } class B88 extends A88 { n() { return this.m(); } } class A89 { m() { return 89; } } class B89 extends A89 { n() { return this.m(); } }
// prettier-ignore
class A90 { m() { return 90; } } class B90 extends A90 { n() { return this.m(); } } class A91 { m() { return 91; } } class B91 extends A91 { n() { return this.m(); } } class A92 { m() { return 92; } } class B92 extends A92 { n() { return this.m(); } }
// prettier-ignore
class A93 { m() { return 93; } } class B93 extends A93 { n() { return this.m(); } } class A94 { m() { return 94; } } class B94 extends A94 { n() { return this.m(); } } class A95 { m() { return 95; } } class B95 extends A95 { n() { return this.m(); } }
// prettier-ignore
class A96 { m() { return 96; } } class B96 extends A96 { n() { return this.m(); } } class A97 { m() { return 97; } } class B97 extends A97 { n() { return this.m(); } } class A98 { m() { return 98; } } class B98 extends A98 { n() { return this.m(); } }
// prettier-ignore
class A99 { m() { return 99; } } class B99 extends A99 { n() { return this.m(); } } class A100 { m() { return 100; } } class B100 extends A100 { n() { return this.m(); } } class A101 { m() { return 101; } } class B101 extends A101 { n() { return this.m(); } }
// prettier-ignore
class A102 { m() { return 102; } } class B102 extends A102 { n() { return this.m(); } } class A103 { m() { return 103; } } class B103 extends A103 { n() { return this.m(); } } class A104 { m() { return 104; } } class B104 extends A104 { n() { return this.m(); } }
// prettier-ignore
class A105 { m() { return 105; } } class B105 extends A105 { n() { return this.m(); } } class A106 { m() { return 106; } } class B106 extends A106 { n() { return this.m(); } } class A107 { m() { return 107; } } class B107 extends A107 { n() { return this.m(); } }
// prettier-ignore
class A108 { m() { return 108; } } class B108 extends A108 { n() { return this.m(); } } class A109 { m() { return 109; } } class B109 extends A109 { n() { return this.m(); } } class A110 { m() { return 110; } } class B110 extends A110 { n() { return this.m(); } }
// prettier-ignore
class A111 { m() { return 111; } } class B111 extends A111 { n() { return this.m(); } } class A112 { m() { return 112; } } class B112 extends A112 { n() { return this.m(); } } class A113 { m() { return 113; } } class B113 extends A113 { n() { return this.m(); } }
// prettier-ignore
class A114 { m() { return 114; } } class B114 extends A114 { n() { return this.m(); } } class A115 { m() { return 115; } } class B115 extends A115 { n() { return this.m(); } } class A116 { m() { return 116; } } class B116 extends A116 { n() { return this.m(); } }
// prettier-ignore
class A117 { m() { return 117; } } class B117 extends A117 { n() { return this.m(); } } class A118 { m() { return 118; } } class B118 extends A118 { n() { return this.m(); } } class A119 { m() { return 119; } } class B119 extends A119 { n() { return this.m(); } }
// prettier-ignore
class A120 { m() { return 120; } } class B120 extends A120 { n() { return this.m(); } } class A121 { m() { return 121; } } class B121 extends A121 { n() { return this.m(); } } class A122 { m() { return 122; } } class B122 extends A122 { n() { return this.m(); } }
// prettier-ignore
class A123 { m() { return 123; } } class B123 extends A123 { n() { return this.m(); } } class A124 { m() { return 124; } } class B124 extends A124 { n() { return this.m(); } } class A125 { m() { return 125; } } class B125 extends A125 { n() { return this.m(); } }
// prettier-ignore
class A126 { m() { return 126; } } class B126 extends A126 { n() { return this.m(); } } class A127 { m() { return 127; } } class B127 extends A127 { n() { return this.m(); } } class A128 { m() { return 128; } } class B128 extends A128 { n() { return this.m(); } }
// prettier-ignore
class A129 { m() { return 129; } } class B129 extends A129 { n() { return this.m(); } } class A130 { m() { return 130; } } class B130 extends A130 { n() { return this.m(); } } class A131 { m() { return 131; } } class B131 extends A131 { n() { return this.m(); } }
// prettier-ignore
class A132 { m() { return 132; } } class B132 extends A132 { n() { return this.m(); } } class A133 { m() { return 133; } } class B133 extends A133 { n() { return this.m(); } } class A134 { m() { return 134; } } class B134 extends A134 { n() { return this.m(); } }
// prettier-ignore
class A135 { m() { return 135; } } class B135 extends A135 { n() { return this.m(); } } class A136 { m() { return 136; } } class B136 extends A136 { n() { return this.m(); } } class A137 { m() { return 137; } } class B137 extends A137 { n() { return this.m(); } }
// prettier-ignore
class A138 { m() { return 138; } } class B138 extends A138 { n() { return this.m(); } } class A139 { m() { return 139; } } class B139 extends A139 { n() { return this.m(); } } class A140 { m() { return 140; } } class B140 extends A140 { n() { return this.m(); } }
// prettier-ignore
class A141 { m() { return 141; } } class B141 extends A141 { n() { return this.m(); } } class A142 { m() { return 142; } } class B142 extends A142 { n() { return this.m(); } } class A143 { m() { return 143; } } class B143 extends A143 { n() { return this.m(); } }
// prettier-ignore
class A144 { m() { return 144; } } class B144 extends A144 { n() { return this.m(); } } class A145 { m() { return 145; } } class B145 extends A145 { n() { return this.m(); } } class A146 { m() { return 146; } } class B146 extends A146 { n() { return this.m(); } }
// prettier-ignore
class A147 { m() { return 147; } } class B147 extends A147 { n() { return this.m(); } } class A148 { m() { return 148; } } class B148 extends A148 { n() { return this.m(); } } class A149 { m() { return 149; } } class B149 extends A149 { n() { return this.m(); } }
// prettier-ignore
class A150 { m() { return 150; } } class B150 extends A150 { n() { return this.m(); } } class A151 { m() { return 151; } } class B151 extends A151 { n() { return this.m(); } } class A152 { m() { return 152; } } class B152 extends A152 { n() { return this.m(); } }
// prettier-ignore
class A153 { m() { return 153; } } class B153 extends A153 { n() { return this.m(); } } class A154 { m() { return 154; } } class B154 extends A154 { n() { return this.m(); } } class A155 { m() { return 155; } } class B155 extends A155 { n() { return this.m(); } }
// prettier-ignore
class A156 { m() { return 156; } } class B156 extends A156 { n() { return this.m(); } } class A157 { m() { return 157; } } class B157 extends A157 { n() { return this.m(); } } class A158 { m() { return 158; } } class B158 extends A158 { n() { return this.m(); } }
// prettier-ignore
class A159 { m() { return 159; } } class B159 extends A159 { n() { return this.m(); } } class A160 { m() { return 160; } } class B160 extends A160 { n() { return this.m(); } } class A161 { m() { return 161; } } class B161 extends A161 { n() { return this.m(); } }
// prettier-ignore
class A162 { m() { return 162; } } class B162 extends A162 { n() { return this.m(); } } class A163 { m() { return 163; } } class B163 extends A163 { n() { return this.m(); } } class A164 { m() { return 164; } } class B164 extends A164 { n() { return this.m(); } }
// prettier-ignore
class A165 { m() { return 165; } } class B165 extends A165 { n() { return this.m(); } } class A166 { m() { return 166; } } class B166 extends A166 { n() { return this.m(); } } class A167 { m() { return 167; } } class B167 extends A167 { n() { return this.m(); } }
// prettier-ignore
class A168 { m() { return 168; } } class B168 extends A168 { n() { return this.m(); } } class A169 { m() { return 169; } } class B169 extends A169 { n() { return this.m(); } } class A170 { m() { return 170; } } class B170 extends A170 { n() { return this.m(); } }
// prettier-ignore
class A171 { m() { return 171; } } class B171 extends A171 { n() { return this.m(); } } class A172 { m() { return 172; } } class B172 extends A172 { n() { return this.m(); } } class A173 { m() { return 173; } } class B173 extends A173 { n() { return this.m(); } }
// prettier-ignore
class A174 { m() { return 174; } } class B174 extends A174 { n() { return this.m(); } } class A175 { m() { return 175; } } class B175 extends A175 { n() { return this.m(); } } class A176 { m() { return 176; } } class B176 extends A176 { n() { return this.m(); } }
// prettier-ignore
class A177 { m() { return 177; } } class B177 extends A177 { n() { return this.m(); } } class A178 { m() { return 178; } } class B178 extends A178 { n() { return this.m(); } } class A179 { m() { return 179; } } class B179 extends A179 { n() { return this.m(); } }
// prettier-ignore
class A180 { m() { return 180; } } class B180 extends A180 { n() { return this.m(); } } class A181 { m() { return 181; } } class B181 extends A181 { n() { return this.m(); } } class A182 { m() { return 182; } } class B182 extends A182 { n() { return this.m(); } }
// prettier-ignore
class A183 { m() { return 183; } } class B183 extends A183 { n() { return this.m(); } } class A184 { m() { return 184; } } class B184 extends A184 { n() { return this.m(); } } class A185 { m() { return 185; } } class B185 extends A185 { n() { return this.m(); } }
// prettier-ignore
class A186 { m() { return 186; } } class B186 extends A186 { n() { return this.m(); } } class A187 { m() { return 187; } } class B187 extends A187 { n() { return this.m(); } } class A188 { m() { return 188; } } class B188 extends A188 { n() { return this.m(); } }
// prettier-ignore
class A189 { m() { return 189; } } class B189 extends A189 { n() { return this.m(); } } class A190 { m() { return 190; } } class B190 extends A190 { n() { return this.m(); } } class A191 { m() { return 191; } } class B191 extends A191 { n() { return this.m(); } }
// prettier-ignore
class A192 { m() { return 192; } } class B192 extends A192 { n() { return this.m(); } } class A193 { m() { return 193; } } class B193 extends A193 { n() { return this.m(); } } class A194 { m() { return 194; } } class B194 extends A194 { n() { return this.m(); } }
// prettier-ignore
class A195 { m() { return 195; } } class B195 extends A195 { n() { return this.m(); } } class A196 { m() { return 196; } } class B196 extends A196 { n() { return this.m(); } } class A197 { m() { return 197; } } class B197 extends A197 { n() { return this.m(); } }
// prettier-ignore
class A198 { m() { return 198; } } class B198 extends A198 { n() { return this.m(); } } class A199 { m() { return 199; } } class B199 extends A199 { n() { return this.m(); } } class A200 { m() { return 200; } } class B200 extends A200 { n() { return this.m(); } }
// prettier-ignore
class A201 { m() { return 201; } } class B201 extends A201 { n() { return this.m(); } } class A202 { m() { return 202; } } class B202 extends A202 { n() { return this.m(); } } class A203 { m() { return 203; } } class B203 extends A203 { n() { return this.m(); } }
// prettier-ignore
class A204 { m() { return 204; } } class B204 extends A204 { n() { return this.m(); } } class A205 { m() { return 205; } } class B205 extends A205 { n() { return this.m(); } } class A206 { m() { return 206; } } class B206 extends A206 { n() { return this.m(); } }
// prettier-ignore
class A207 { m() { return 207; } } class B207 extends A207 { n() { return this.m(); } } class A208 { m() { return 208; } } class B208 extends A208 { n() { return this.m(); } } class A209 { m() { return 209; } } class B209 extends A209 { n() { return this.m(); } }
// prettier-ignore
class A210 { m() { return 210; } } class B210 extends A210 { n() { return this.m(); } } class A211 { m() { return 211; } } class B211 extends A211 { n() { return this.m(); } } class A212 { m() { return 212; } } class B212 extends A212 { n() { return this.m(); } }
// prettier-ignore
class A213 { m() { return 213; } } class B213 extends A213 { n() { return this.m(); } } class A214 { m() { return 214; } } class B214 extends A214 { n() { return this.m(); } } class A215 { m() { return 215; } } class B215 extends A215 { n() { return this.m(); } }
// prettier-ignore
class A216 { m() { return 216; } } class B216 extends A216 { n() { return this.m(); } } class A217 { m() { return 217; } } class B217 extends A217 { n() { return this.m(); } } class A218 { m() { return 218; } } class B218 extends A218 { n() { return this.m(); } }
// prettier-ignore
class A219 { m() { return 219; } } class B219 extends A219 { n() { return this.m(); } } class A220 { m() { return 220; } } class B220 extends A220 { n() { return this.m(); } } class A221 { m() { return 221; } } class B221 extends A221 { n() { return this.m(); } }
// prettier-ignore
class A222 { m() { return 222; } } class B222 extends A222 { n() { return this.m(); } } class A223 { m() { return 223; } } class B223 extends A223 { n() { return this.m(); } } class A224 { m() { return 224; } } class B224 extends A224 { n() { return this.m(); } }
// prettier-ignore
class A225 { m() { return 225; } } class B225 extends A225 { n() { return this.m(); } } class A226 { m() { return 226; } } class B226 extends A226 { n() { return this.m(); } } class A227 { m() { return 227; } } class B227 extends A227 { n() { return this.m(); } }
// prettier-ignore
class A228 { m() { return 228; } } class B228 extends A228 { n() { return this.m(); } } class A229 { m() { return 229; } } class B229 extends A229 { n() { return this.m(); } } class A230 { m() { return 230; } } class B230 extends A230 { n() { return this.m(); } }
// prettier-ignore
class A231 { m() { return 231; } } class B231 extends A231 { n() { return this.m(); } } class A232 { m() { return 232; } } class B232 extends A232 { n() { return this.m(); } } class A233 { m() { return 233; } } class B233 extends A233 { n() { return this.m(); } }
// prettier-ignore
class A234 { m() { return 234; } } class B234 extends A234 { n() { return this.m(); } } class A235 { m() { return 235; } } class B235 extends A235 { n() { return this.m(); } } class A236 { m() { return 236; } } class B236 extends A236 { n() { return this.m(); } }
// prettier-ignore
class A237 { m() { return 237; } } class B237 extends A237 { n() { return this.m(); } } class A238 { m() { return 238; } } class B238 extends A238 { n() { return this.m(); } } class A239 { m() { return 239; } } class B239 extends A239 { n() { return this.m(); } }
// prettier-ignore
class A240 { m() { return 240; } } class B240 extends A240 { n() { return this.m(); } } class A241 { m() { return 241; } } class B241 extends A241 { n() { return this.m(); } } class A242 { m() { return 242; } } class B242 extends A242 { n() { return this.m(); } }
// prettier-ignore
class A243 { m() { return 243; } } class B243 extends A243 { n() { return this.m(); } } class A244 { m() { return 244; } } class B244 extends A244 { n() { return this.m(); } } class A245 { m() { return 245; } } class B245 extends A245 { n() { return this.m(); } }
// prettier-ignore
class A246 { m() { return 246; } } class B246 extends A246 { n() { return this.m(); } } class A247 { m() { return 247; } } class B247 extends A247 { n() { return this.m(); } } class A248 { m() { return 248; } } class B248 extends A248 { n() { return this.m(); } }
// prettier-ignore
class A249 { m() { return 249; } } class B249 extends A249 { n() { return this.m(); } } class A250 { m() { return 250; } } class B250 extends A250 { n() { return this.m(); } } class A251 { m() { return 251; } } class B251 extends A251 { n() { return this.m(); } }
// prettier-ignore
class A252 { m() { return 252; } } class B252 extends A252 { n() { return this.m(); } } class A253 { m() { return 253; } } class B253 extends A253 { n() { return this.m(); } } class A254 { m() { return 254; } } class B254 extends A254 { n() { return this.m(); } }
// prettier-ignore
class A255 { m() { return 255; } } class B255 extends A255 { n() { return this.m(); } } class A256 { m() { return 256; } } class B256 extends A256 { n() { return this.m(); } } class A257 { m() { return 257; } } class B257 extends A257 { n() { return this.m(); } }
// prettier-ignore
class A258 { m() { return 258; } } class B258 extends A258 { n() { return this.m(); } } class A259 { m() { return 259; } } class B259 extends A259 { n() { return this.m(); } } class A260 { m() { return 260; } } class B260 extends A260 { n() { return this.m(); } }
// prettier-ignore
class A261 { m() { return 261; } } class B261 extends A261 { n() { return this.m(); } } class A262 { m() { return 262; } } class B262 extends A262 { n() { return this.m(); } } class A263 { m() { return 263; } } class B263 extends A263 { n() { return this.m(); } }
// prettier-ignore
class A264 { m() { return 264; } } class B264 extends A264 { n() { return this.m(); } } class A265 { m() { return 265; } } class B265 extends A265 { n() { return this.m(); } } class A266 { m() { return 266; } } class B266 extends A266 { n() { return this.m(); } }
// prettier-ignore
class A267 { m() { return 267; } } class B267 extends A267 { n() { return this.m(); } } class A268 { m() { return 268; } } class B268 extends A268 { n() { return this.m(); } } class A269 { m() { return 269; } } class B269 extends A269 { n() { return this.m(); } }
// prettier-ignore
class A270 { m() { return 270; } } class B270 extends A270 { n() { return this.m(); } } class A271 { m() { return 271; } } class B271 extends A271 { n() { return this.m(); } } class A272 { m() { return 272; } } class B272 extends A272 { n() { return this.m(); } }
// prettier-ignore
class A273 { m() { return 273; } } class B273 extends A273 { n() { return this.m(); } } class A274 { m() { return 274; } } class B274 extends A274 { n() { return this.m(); } } class A275 { m() { return 275; } } class B275 extends A275 { n() { return this.m(); } }
// prettier-ignore
class A276 { m() { return 276; } } class B276 extends A276 { n() { return this.m(); } } class A277 { m() { return 277; } } class B277 extends A277 { n() { return this.m(); } } class A278 { m() { return 278; } } class B278 extends A278 { n() { return this.m(); } }
// prettier-ignore
class A279 { m() { return 279; } } class B279 extends A279 { n() { return this.m(); } } class A280 { m() { return 280; } } class B280 extends A280 { n() { return this.m(); } } class A281 { m() { return 281; } } class B281 extends A281 { n() { return this.m(); } }
// prettier-ignore
class A282 { m() { return 282; } } class B282 extends A282 { n() { return this.m(); } } class A283 { m() { return 283; } } class B283 extends A283 { n() { return this.m(); } } class A284 { m() { return 284; } } class B284 extends A284 { n() { return this.m(); } }
// prettier-ignore
class A285 { m() { return 285; } } class B285 extends A285 { n() { return this.m(); } } class A286 { m() { return 286; } } class B286 extends A286 { n() { return this.m(); } } class A287 { m() { return 287; } } class B287 extends A287 { n() { return this.m(); } }
// prettier-ignore
class A288 { m() { return 288; } } class B288 extends A288 { n() { return this.m(); } } class A289 { m() { return 289; } } class B289 extends A289 { n() { return this.m(); } } class A290 { m() { return 290; } } class B290 extends A290 { n() { return this.m(); } }
// prettier-ignore
class A291 { m() { return 291; } } class B291 extends A291 { n() { return this.m(); } } class A292 { m() { return 292; } } class B292 extends A292 { n() { return this.m(); } } class A293 { m() { return 293; } } class B293 extends A293 { n() { return this.m(); } }
// prettier-ignore
class A294 { m() { return 294; } } class B294 extends A294 { n() { return this.m(); } } class A295 { m() { return 295; } } class B295 extends A295 { n() { return this.m(); } } class A296 { m() { return 296; } } class B296 extends A296 { n() { return this.m(); } }
// prettier-ignore
class A297 { m() { return 297; } } class B297 extends A297 { n() { return this.m(); } } class A298 { m() { return 298; } } class B298 extends A298 { n() { return this.m(); } } class A299 { m() { return 299; } } class B299 extends A299 { n() { return this.m(); } }
const after = count();
console.log("structures: fewer than five for three pairs:", (after[0] - before[0]) * 3 < 300 * 5);
console.log("objects: fewer than five for three pairs:", (after[1] - before[1]) * 3 < 300 * 5);
let sum = 0;
for (const make of makers) sum += make();
console.log(sum, Object.getPrototypeOf(B7.prototype) === A7.prototype, B9.prototype.constructor === B9);
/* Output:
structures: fewer than five for three pairs: true
objects: fewer than five for three pairs: true
44850 true true
*/
