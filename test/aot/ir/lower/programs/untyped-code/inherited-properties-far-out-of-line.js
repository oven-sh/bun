// RUN: lower
// OPTIONS: builtin-modules

// Prototypes with hundreds of properties: methods that are called, values that are read. What is inherited has its place in the table by name however far out of line it lies in its holder: every answer is that of the language, also after the holder has changed.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const visits = () => count("operationAOTGetByIdAndCache") + count("operationAOTPutByIdAndCache");
function Wide(base) { this.base = base; }
Wide.prototype.m0 = function (x) { return this.base + x + 0; }; Wide.prototype.m1 = function (x) { return this.base + x + 1; }; Wide.prototype.m2 = function (x) { return this.base + x + 2; }; Wide.prototype.m3 = function (x) { return this.base + x + 3; }; Wide.prototype.m4 = function (x) { return this.base + x + 4; };
Wide.prototype.m5 = function (x) { return this.base + x + 5; }; Wide.prototype.m6 = function (x) { return this.base + x + 6; }; Wide.prototype.m7 = function (x) { return this.base + x + 7; }; Wide.prototype.m8 = function (x) { return this.base + x + 8; }; Wide.prototype.m9 = function (x) { return this.base + x + 9; };
Wide.prototype.m10 = function (x) { return this.base + x + 10; }; Wide.prototype.m11 = function (x) { return this.base + x + 11; }; Wide.prototype.m12 = function (x) { return this.base + x + 12; }; Wide.prototype.m13 = function (x) { return this.base + x + 13; }; Wide.prototype.m14 = function (x) { return this.base + x + 14; };
Wide.prototype.m15 = function (x) { return this.base + x + 15; }; Wide.prototype.m16 = function (x) { return this.base + x + 16; }; Wide.prototype.m17 = function (x) { return this.base + x + 17; }; Wide.prototype.m18 = function (x) { return this.base + x + 18; }; Wide.prototype.m19 = function (x) { return this.base + x + 19; };
Wide.prototype.m20 = function (x) { return this.base + x + 20; }; Wide.prototype.m21 = function (x) { return this.base + x + 21; }; Wide.prototype.m22 = function (x) { return this.base + x + 22; }; Wide.prototype.m23 = function (x) { return this.base + x + 23; }; Wide.prototype.m24 = function (x) { return this.base + x + 24; };
Wide.prototype.m25 = function (x) { return this.base + x + 25; }; Wide.prototype.m26 = function (x) { return this.base + x + 26; }; Wide.prototype.m27 = function (x) { return this.base + x + 27; }; Wide.prototype.m28 = function (x) { return this.base + x + 28; }; Wide.prototype.m29 = function (x) { return this.base + x + 29; };
Wide.prototype.m30 = function (x) { return this.base + x + 30; }; Wide.prototype.m31 = function (x) { return this.base + x + 31; }; Wide.prototype.m32 = function (x) { return this.base + x + 32; }; Wide.prototype.m33 = function (x) { return this.base + x + 33; }; Wide.prototype.m34 = function (x) { return this.base + x + 34; };
Wide.prototype.m35 = function (x) { return this.base + x + 35; }; Wide.prototype.m36 = function (x) { return this.base + x + 36; }; Wide.prototype.m37 = function (x) { return this.base + x + 37; }; Wide.prototype.m38 = function (x) { return this.base + x + 38; }; Wide.prototype.m39 = function (x) { return this.base + x + 39; };
Wide.prototype.m40 = function (x) { return this.base + x + 40; }; Wide.prototype.m41 = function (x) { return this.base + x + 41; }; Wide.prototype.m42 = function (x) { return this.base + x + 42; }; Wide.prototype.m43 = function (x) { return this.base + x + 43; }; Wide.prototype.m44 = function (x) { return this.base + x + 44; };
Wide.prototype.m45 = function (x) { return this.base + x + 45; }; Wide.prototype.m46 = function (x) { return this.base + x + 46; }; Wide.prototype.m47 = function (x) { return this.base + x + 47; }; Wide.prototype.m48 = function (x) { return this.base + x + 48; }; Wide.prototype.m49 = function (x) { return this.base + x + 49; };
Wide.prototype.m50 = function (x) { return this.base + x + 50; }; Wide.prototype.m51 = function (x) { return this.base + x + 51; }; Wide.prototype.m52 = function (x) { return this.base + x + 52; }; Wide.prototype.m53 = function (x) { return this.base + x + 53; }; Wide.prototype.m54 = function (x) { return this.base + x + 54; };
Wide.prototype.m55 = function (x) { return this.base + x + 55; }; Wide.prototype.m56 = function (x) { return this.base + x + 56; }; Wide.prototype.m57 = function (x) { return this.base + x + 57; }; Wide.prototype.m58 = function (x) { return this.base + x + 58; }; Wide.prototype.m59 = function (x) { return this.base + x + 59; };
Wide.prototype.m60 = function (x) { return this.base + x + 60; }; Wide.prototype.m61 = function (x) { return this.base + x + 61; }; Wide.prototype.m62 = function (x) { return this.base + x + 62; }; Wide.prototype.m63 = function (x) { return this.base + x + 63; }; Wide.prototype.m64 = function (x) { return this.base + x + 64; };
Wide.prototype.m65 = function (x) { return this.base + x + 65; }; Wide.prototype.m66 = function (x) { return this.base + x + 66; }; Wide.prototype.m67 = function (x) { return this.base + x + 67; }; Wide.prototype.m68 = function (x) { return this.base + x + 68; }; Wide.prototype.m69 = function (x) { return this.base + x + 69; };
Wide.prototype.m70 = function (x) { return this.base + x + 70; }; Wide.prototype.m71 = function (x) { return this.base + x + 71; }; Wide.prototype.m72 = function (x) { return this.base + x + 72; }; Wide.prototype.m73 = function (x) { return this.base + x + 73; }; Wide.prototype.m74 = function (x) { return this.base + x + 74; };
Wide.prototype.m75 = function (x) { return this.base + x + 75; }; Wide.prototype.m76 = function (x) { return this.base + x + 76; }; Wide.prototype.m77 = function (x) { return this.base + x + 77; }; Wide.prototype.m78 = function (x) { return this.base + x + 78; }; Wide.prototype.m79 = function (x) { return this.base + x + 79; };
Wide.prototype.m80 = function (x) { return this.base + x + 80; }; Wide.prototype.m81 = function (x) { return this.base + x + 81; }; Wide.prototype.m82 = function (x) { return this.base + x + 82; }; Wide.prototype.m83 = function (x) { return this.base + x + 83; }; Wide.prototype.m84 = function (x) { return this.base + x + 84; };
Wide.prototype.m85 = function (x) { return this.base + x + 85; }; Wide.prototype.m86 = function (x) { return this.base + x + 86; }; Wide.prototype.m87 = function (x) { return this.base + x + 87; }; Wide.prototype.m88 = function (x) { return this.base + x + 88; }; Wide.prototype.m89 = function (x) { return this.base + x + 89; };
Wide.prototype.m90 = function (x) { return this.base + x + 90; }; Wide.prototype.m91 = function (x) { return this.base + x + 91; }; Wide.prototype.m92 = function (x) { return this.base + x + 92; }; Wide.prototype.m93 = function (x) { return this.base + x + 93; }; Wide.prototype.m94 = function (x) { return this.base + x + 94; };
Wide.prototype.m95 = function (x) { return this.base + x + 95; }; Wide.prototype.m96 = function (x) { return this.base + x + 96; }; Wide.prototype.m97 = function (x) { return this.base + x + 97; }; Wide.prototype.m98 = function (x) { return this.base + x + 98; }; Wide.prototype.m99 = function (x) { return this.base + x + 99; };
Wide.prototype.m100 = function (x) { return this.base + x + 100; }; Wide.prototype.m101 = function (x) { return this.base + x + 101; }; Wide.prototype.m102 = function (x) { return this.base + x + 102; }; Wide.prototype.m103 = function (x) { return this.base + x + 103; }; Wide.prototype.m104 = function (x) { return this.base + x + 104; };
Wide.prototype.m105 = function (x) { return this.base + x + 105; }; Wide.prototype.m106 = function (x) { return this.base + x + 106; }; Wide.prototype.m107 = function (x) { return this.base + x + 107; }; Wide.prototype.m108 = function (x) { return this.base + x + 108; }; Wide.prototype.m109 = function (x) { return this.base + x + 109; };
Wide.prototype.m110 = function (x) { return this.base + x + 110; }; Wide.prototype.m111 = function (x) { return this.base + x + 111; }; Wide.prototype.m112 = function (x) { return this.base + x + 112; }; Wide.prototype.m113 = function (x) { return this.base + x + 113; }; Wide.prototype.m114 = function (x) { return this.base + x + 114; };
Wide.prototype.m115 = function (x) { return this.base + x + 115; }; Wide.prototype.m116 = function (x) { return this.base + x + 116; }; Wide.prototype.m117 = function (x) { return this.base + x + 117; }; Wide.prototype.m118 = function (x) { return this.base + x + 118; }; Wide.prototype.m119 = function (x) { return this.base + x + 119; };
Wide.prototype.m120 = function (x) { return this.base + x + 120; }; Wide.prototype.m121 = function (x) { return this.base + x + 121; }; Wide.prototype.m122 = function (x) { return this.base + x + 122; }; Wide.prototype.m123 = function (x) { return this.base + x + 123; }; Wide.prototype.m124 = function (x) { return this.base + x + 124; };
Wide.prototype.m125 = function (x) { return this.base + x + 125; }; Wide.prototype.m126 = function (x) { return this.base + x + 126; }; Wide.prototype.m127 = function (x) { return this.base + x + 127; }; Wide.prototype.m128 = function (x) { return this.base + x + 128; }; Wide.prototype.m129 = function (x) { return this.base + x + 129; };
Wide.prototype.m130 = function (x) { return this.base + x + 130; }; Wide.prototype.m131 = function (x) { return this.base + x + 131; }; Wide.prototype.m132 = function (x) { return this.base + x + 132; }; Wide.prototype.m133 = function (x) { return this.base + x + 133; }; Wide.prototype.m134 = function (x) { return this.base + x + 134; };
Wide.prototype.m135 = function (x) { return this.base + x + 135; }; Wide.prototype.m136 = function (x) { return this.base + x + 136; }; Wide.prototype.m137 = function (x) { return this.base + x + 137; }; Wide.prototype.m138 = function (x) { return this.base + x + 138; }; Wide.prototype.m139 = function (x) { return this.base + x + 139; };
Wide.prototype.m140 = function (x) { return this.base + x + 140; }; Wide.prototype.m141 = function (x) { return this.base + x + 141; }; Wide.prototype.m142 = function (x) { return this.base + x + 142; }; Wide.prototype.m143 = function (x) { return this.base + x + 143; }; Wide.prototype.m144 = function (x) { return this.base + x + 144; };
Wide.prototype.m145 = function (x) { return this.base + x + 145; }; Wide.prototype.m146 = function (x) { return this.base + x + 146; }; Wide.prototype.m147 = function (x) { return this.base + x + 147; }; Wide.prototype.m148 = function (x) { return this.base + x + 148; }; Wide.prototype.m149 = function (x) { return this.base + x + 149; };
Wide.prototype.m150 = function (x) { return this.base + x + 150; }; Wide.prototype.m151 = function (x) { return this.base + x + 151; }; Wide.prototype.m152 = function (x) { return this.base + x + 152; }; Wide.prototype.m153 = function (x) { return this.base + x + 153; }; Wide.prototype.m154 = function (x) { return this.base + x + 154; };
Wide.prototype.m155 = function (x) { return this.base + x + 155; }; Wide.prototype.m156 = function (x) { return this.base + x + 156; }; Wide.prototype.m157 = function (x) { return this.base + x + 157; }; Wide.prototype.m158 = function (x) { return this.base + x + 158; }; Wide.prototype.m159 = function (x) { return this.base + x + 159; };
Wide.prototype.m160 = function (x) { return this.base + x + 160; }; Wide.prototype.m161 = function (x) { return this.base + x + 161; }; Wide.prototype.m162 = function (x) { return this.base + x + 162; }; Wide.prototype.m163 = function (x) { return this.base + x + 163; }; Wide.prototype.m164 = function (x) { return this.base + x + 164; };
Wide.prototype.m165 = function (x) { return this.base + x + 165; }; Wide.prototype.m166 = function (x) { return this.base + x + 166; }; Wide.prototype.m167 = function (x) { return this.base + x + 167; }; Wide.prototype.m168 = function (x) { return this.base + x + 168; }; Wide.prototype.m169 = function (x) { return this.base + x + 169; };
Wide.prototype.m170 = function (x) { return this.base + x + 170; }; Wide.prototype.m171 = function (x) { return this.base + x + 171; }; Wide.prototype.m172 = function (x) { return this.base + x + 172; }; Wide.prototype.m173 = function (x) { return this.base + x + 173; }; Wide.prototype.m174 = function (x) { return this.base + x + 174; };
Wide.prototype.m175 = function (x) { return this.base + x + 175; }; Wide.prototype.m176 = function (x) { return this.base + x + 176; }; Wide.prototype.m177 = function (x) { return this.base + x + 177; }; Wide.prototype.m178 = function (x) { return this.base + x + 178; }; Wide.prototype.m179 = function (x) { return this.base + x + 179; };
Wide.prototype.m180 = function (x) { return this.base + x + 180; }; Wide.prototype.m181 = function (x) { return this.base + x + 181; }; Wide.prototype.m182 = function (x) { return this.base + x + 182; }; Wide.prototype.m183 = function (x) { return this.base + x + 183; }; Wide.prototype.m184 = function (x) { return this.base + x + 184; };
Wide.prototype.m185 = function (x) { return this.base + x + 185; }; Wide.prototype.m186 = function (x) { return this.base + x + 186; }; Wide.prototype.m187 = function (x) { return this.base + x + 187; }; Wide.prototype.m188 = function (x) { return this.base + x + 188; }; Wide.prototype.m189 = function (x) { return this.base + x + 189; };
Wide.prototype.m190 = function (x) { return this.base + x + 190; }; Wide.prototype.m191 = function (x) { return this.base + x + 191; }; Wide.prototype.m192 = function (x) { return this.base + x + 192; }; Wide.prototype.m193 = function (x) { return this.base + x + 193; }; Wide.prototype.m194 = function (x) { return this.base + x + 194; };
Wide.prototype.m195 = function (x) { return this.base + x + 195; }; Wide.prototype.m196 = function (x) { return this.base + x + 196; }; Wide.prototype.m197 = function (x) { return this.base + x + 197; }; Wide.prototype.m198 = function (x) { return this.base + x + 198; }; Wide.prototype.m199 = function (x) { return this.base + x + 199; };
Wide.prototype.m200 = function (x) { return this.base + x + 200; }; Wide.prototype.m201 = function (x) { return this.base + x + 201; }; Wide.prototype.m202 = function (x) { return this.base + x + 202; }; Wide.prototype.m203 = function (x) { return this.base + x + 203; }; Wide.prototype.m204 = function (x) { return this.base + x + 204; };
Wide.prototype.m205 = function (x) { return this.base + x + 205; }; Wide.prototype.m206 = function (x) { return this.base + x + 206; }; Wide.prototype.m207 = function (x) { return this.base + x + 207; }; Wide.prototype.m208 = function (x) { return this.base + x + 208; }; Wide.prototype.m209 = function (x) { return this.base + x + 209; };
Wide.prototype.m210 = function (x) { return this.base + x + 210; }; Wide.prototype.m211 = function (x) { return this.base + x + 211; }; Wide.prototype.m212 = function (x) { return this.base + x + 212; }; Wide.prototype.m213 = function (x) { return this.base + x + 213; }; Wide.prototype.m214 = function (x) { return this.base + x + 214; };
Wide.prototype.m215 = function (x) { return this.base + x + 215; }; Wide.prototype.m216 = function (x) { return this.base + x + 216; }; Wide.prototype.m217 = function (x) { return this.base + x + 217; }; Wide.prototype.m218 = function (x) { return this.base + x + 218; }; Wide.prototype.m219 = function (x) { return this.base + x + 219; };
Wide.prototype.m220 = function (x) { return this.base + x + 220; }; Wide.prototype.m221 = function (x) { return this.base + x + 221; }; Wide.prototype.m222 = function (x) { return this.base + x + 222; }; Wide.prototype.m223 = function (x) { return this.base + x + 223; }; Wide.prototype.m224 = function (x) { return this.base + x + 224; };
Wide.prototype.m225 = function (x) { return this.base + x + 225; }; Wide.prototype.m226 = function (x) { return this.base + x + 226; }; Wide.prototype.m227 = function (x) { return this.base + x + 227; }; Wide.prototype.m228 = function (x) { return this.base + x + 228; }; Wide.prototype.m229 = function (x) { return this.base + x + 229; };
Wide.prototype.m230 = function (x) { return this.base + x + 230; }; Wide.prototype.m231 = function (x) { return this.base + x + 231; }; Wide.prototype.m232 = function (x) { return this.base + x + 232; }; Wide.prototype.m233 = function (x) { return this.base + x + 233; }; Wide.prototype.m234 = function (x) { return this.base + x + 234; };
Wide.prototype.m235 = function (x) { return this.base + x + 235; }; Wide.prototype.m236 = function (x) { return this.base + x + 236; }; Wide.prototype.m237 = function (x) { return this.base + x + 237; }; Wide.prototype.m238 = function (x) { return this.base + x + 238; }; Wide.prototype.m239 = function (x) { return this.base + x + 239; };
Wide.prototype.m240 = function (x) { return this.base + x + 240; }; Wide.prototype.m241 = function (x) { return this.base + x + 241; }; Wide.prototype.m242 = function (x) { return this.base + x + 242; }; Wide.prototype.m243 = function (x) { return this.base + x + 243; }; Wide.prototype.m244 = function (x) { return this.base + x + 244; };
Wide.prototype.m245 = function (x) { return this.base + x + 245; }; Wide.prototype.m246 = function (x) { return this.base + x + 246; }; Wide.prototype.m247 = function (x) { return this.base + x + 247; }; Wide.prototype.m248 = function (x) { return this.base + x + 248; }; Wide.prototype.m249 = function (x) { return this.base + x + 249; };
Wide.prototype.m250 = function (x) { return this.base + x + 250; }; Wide.prototype.m251 = function (x) { return this.base + x + 251; }; Wide.prototype.m252 = function (x) { return this.base + x + 252; }; Wide.prototype.m253 = function (x) { return this.base + x + 253; }; Wide.prototype.m254 = function (x) { return this.base + x + 254; };
Wide.prototype.m255 = function (x) { return this.base + x + 255; }; Wide.prototype.m256 = function (x) { return this.base + x + 256; }; Wide.prototype.m257 = function (x) { return this.base + x + 257; }; Wide.prototype.m258 = function (x) { return this.base + x + 258; }; Wide.prototype.m259 = function (x) { return this.base + x + 259; };
Wide.prototype.m260 = function (x) { return this.base + x + 260; }; Wide.prototype.m261 = function (x) { return this.base + x + 261; }; Wide.prototype.m262 = function (x) { return this.base + x + 262; }; Wide.prototype.m263 = function (x) { return this.base + x + 263; }; Wide.prototype.m264 = function (x) { return this.base + x + 264; };
Wide.prototype.m265 = function (x) { return this.base + x + 265; }; Wide.prototype.m266 = function (x) { return this.base + x + 266; }; Wide.prototype.m267 = function (x) { return this.base + x + 267; }; Wide.prototype.m268 = function (x) { return this.base + x + 268; }; Wide.prototype.m269 = function (x) { return this.base + x + 269; };
Wide.prototype.m270 = function (x) { return this.base + x + 270; }; Wide.prototype.m271 = function (x) { return this.base + x + 271; }; Wide.prototype.m272 = function (x) { return this.base + x + 272; }; Wide.prototype.m273 = function (x) { return this.base + x + 273; }; Wide.prototype.m274 = function (x) { return this.base + x + 274; };
Wide.prototype.m275 = function (x) { return this.base + x + 275; }; Wide.prototype.m276 = function (x) { return this.base + x + 276; }; Wide.prototype.m277 = function (x) { return this.base + x + 277; }; Wide.prototype.m278 = function (x) { return this.base + x + 278; }; Wide.prototype.m279 = function (x) { return this.base + x + 279; };
Wide.prototype.m280 = function (x) { return this.base + x + 280; }; Wide.prototype.m281 = function (x) { return this.base + x + 281; }; Wide.prototype.m282 = function (x) { return this.base + x + 282; }; Wide.prototype.m283 = function (x) { return this.base + x + 283; }; Wide.prototype.m284 = function (x) { return this.base + x + 284; };
Wide.prototype.m285 = function (x) { return this.base + x + 285; }; Wide.prototype.m286 = function (x) { return this.base + x + 286; }; Wide.prototype.m287 = function (x) { return this.base + x + 287; }; Wide.prototype.m288 = function (x) { return this.base + x + 288; }; Wide.prototype.m289 = function (x) { return this.base + x + 289; };
Wide.prototype.m290 = function (x) { return this.base + x + 290; }; Wide.prototype.m291 = function (x) { return this.base + x + 291; }; Wide.prototype.m292 = function (x) { return this.base + x + 292; }; Wide.prototype.m293 = function (x) { return this.base + x + 293; }; Wide.prototype.m294 = function (x) { return this.base + x + 294; };
Wide.prototype.m295 = function (x) { return this.base + x + 295; }; Wide.prototype.m296 = function (x) { return this.base + x + 296; }; Wide.prototype.m297 = function (x) { return this.base + x + 297; }; Wide.prototype.m298 = function (x) { return this.base + x + 298; }; Wide.prototype.m299 = function (x) { return this.base + x + 299; };
Wide.prototype.v0 = 0; Wide.prototype.v1 = 3; Wide.prototype.v2 = 6; Wide.prototype.v3 = 9; Wide.prototype.v4 = 12; Wide.prototype.v5 = 15; Wide.prototype.v6 = 18; Wide.prototype.v7 = 21; Wide.prototype.v8 = 24; Wide.prototype.v9 = 27;
Wide.prototype.v10 = 30; Wide.prototype.v11 = 33; Wide.prototype.v12 = 36; Wide.prototype.v13 = 39; Wide.prototype.v14 = 42; Wide.prototype.v15 = 45; Wide.prototype.v16 = 48; Wide.prototype.v17 = 51; Wide.prototype.v18 = 54; Wide.prototype.v19 = 57;
Wide.prototype.v20 = 60; Wide.prototype.v21 = 63; Wide.prototype.v22 = 66; Wide.prototype.v23 = 69; Wide.prototype.v24 = 72; Wide.prototype.v25 = 75; Wide.prototype.v26 = 78; Wide.prototype.v27 = 81; Wide.prototype.v28 = 84; Wide.prototype.v29 = 87;
Wide.prototype.v30 = 90; Wide.prototype.v31 = 93; Wide.prototype.v32 = 96; Wide.prototype.v33 = 99; Wide.prototype.v34 = 102; Wide.prototype.v35 = 105; Wide.prototype.v36 = 108; Wide.prototype.v37 = 111; Wide.prototype.v38 = 114; Wide.prototype.v39 = 117;
Wide.prototype.v40 = 120; Wide.prototype.v41 = 123; Wide.prototype.v42 = 126; Wide.prototype.v43 = 129; Wide.prototype.v44 = 132; Wide.prototype.v45 = 135; Wide.prototype.v46 = 138; Wide.prototype.v47 = 141; Wide.prototype.v48 = 144; Wide.prototype.v49 = 147;
Wide.prototype.v50 = 150; Wide.prototype.v51 = 153; Wide.prototype.v52 = 156; Wide.prototype.v53 = 159; Wide.prototype.v54 = 162; Wide.prototype.v55 = 165; Wide.prototype.v56 = 168; Wide.prototype.v57 = 171; Wide.prototype.v58 = 174; Wide.prototype.v59 = 177;
Wide.prototype.v60 = 180; Wide.prototype.v61 = 183; Wide.prototype.v62 = 186; Wide.prototype.v63 = 189; Wide.prototype.v64 = 192; Wide.prototype.v65 = 195; Wide.prototype.v66 = 198; Wide.prototype.v67 = 201; Wide.prototype.v68 = 204; Wide.prototype.v69 = 207;
Wide.prototype.v70 = 210; Wide.prototype.v71 = 213; Wide.prototype.v72 = 216; Wide.prototype.v73 = 219; Wide.prototype.v74 = 222; Wide.prototype.v75 = 225; Wide.prototype.v76 = 228; Wide.prototype.v77 = 231; Wide.prototype.v78 = 234; Wide.prototype.v79 = 237;
Wide.prototype.v80 = 240; Wide.prototype.v81 = 243; Wide.prototype.v82 = 246; Wide.prototype.v83 = 249; Wide.prototype.v84 = 252; Wide.prototype.v85 = 255; Wide.prototype.v86 = 258; Wide.prototype.v87 = 261; Wide.prototype.v88 = 264; Wide.prototype.v89 = 267;
Wide.prototype.v90 = 270; Wide.prototype.v91 = 273; Wide.prototype.v92 = 276; Wide.prototype.v93 = 279; Wide.prototype.v94 = 282; Wide.prototype.v95 = 285; Wide.prototype.v96 = 288; Wide.prototype.v97 = 291; Wide.prototype.v98 = 294; Wide.prototype.v99 = 297;
class Narrow extends Wide { constructor(base) { super(base); this.own = base * 2; } m7(x) { return -x; } }
function callAll(o, x) { return o.m0(x) + o.m7(x) * 2 + o.m100(x) * 3 + o.m130(x) * 5 + o.m131(x) * 7 + o.m132(x) * 11 + o.m200(x) * 13 + o.m299(x) * 17; }
function readAll(o) { return o.v0 + o.v1 * 2 + o.v50 * 3 + o.v99 * 5 + (typeof o.m133 === "function" ? 7 : 0) + (typeof o.m298 === "function" ? 11 : 0) + (o.m300 === undefined ? 13 : 0); }
const objects = [new Wide(1), new Narrow(10), Object.create(new Wide(100)), Object.assign(new Wide(1000), { extra: 1 })];
let sum = 0;
const mix = n => { sum = Math.imul(sum, 31) + (n | 0) | 0; };
const round = i => { for (const o of objects) { mix(callAll(o, i)); mix(readAll(o)); } };
round(1);
console.log("the first round:", sum, objects[0].m299(1), objects[1].m7(5), objects[2].m200(2), objects[3].v99);
for (let i = 0; i < 30; i++) round(i);
const before = visits();
for (let i = 0; i < 300; i++) round(i);
console.log("300 rounds:", sum, "the run time is asked at most fifty times:", typeof aotOperationCount !== "function" || visits() - before <= 50);
Wide.prototype.m299 = function (x) { return x * 1000; };
Wide.prototype.v99 = -1;
round(2);
console.log("a method and a value far out of line are replaced:", sum, objects[0].m299(1), objects[2].v99);
objects[0].m200 = function (x) { return 5; };
objects[1].v50 = 6;
round(3);
console.log("they are shadowed:", sum, objects[0].m200(1), objects[1].m200(1), objects[1].v50, objects[3].v50);
delete Wide.prototype.m131;
let thrown = "";
try { round(4); } catch (error) { thrown = error instanceof TypeError ? "a TypeError" : String(error); }
console.log("one is deleted:", sum, thrown, typeof objects[3].m131, typeof objects[3].m132);
Wide.prototype.m131 = function (x) { return 131; };
Object.defineProperty(Wide.prototype, "v1", { get() { return this.base; }, configurable: true });
Object.setPrototypeOf(objects[3], { m0() { return 1; }, m7() { return 2; }, m100() { return 3; }, m130() { return 4; }, m131() { return 5; }, m132() { return 6; }, m200() { return 7; }, m299() { return 8; } });
round(5);
console.log("after more changes:", sum, objects[0].m131(0), objects[0].v1, objects[1].v1, objects[3].m299(), objects[3].v99);

// GENERATED: Narrow m7 mix get
// CHECK-LABEL: function {{*}}name="Narrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = SuperConstruct v4, v1, v5 layout=[[L_1]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11) frequency=Unlikely:
// CHECK-NEXT: v12 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v12
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v15 = Integer integer=2
// CHECK-NEXT: v16 = Mul v5, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v14, v17 key="own"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: v20 = TypeTest v19 testedType=object
// CHECK-NEXT: Branch v20 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: Jump -> next b10(v21)
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: v23 = TypeTest v22 testedType=undefined
// CHECK-NEXT: Branch v23 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v24):
// CHECK-NEXT: v25 = TypeTest v13 testedType=absent
// CHECK-NEXT: Branch v25 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v26) frequency=Unlikely:
// CHECK-NEXT: v27 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v27
// CHECK-NEXT: b9(v28):
// CHECK-NEXT: Jump -> next b10(v28)
// CHECK-NEXT: b10(v29):
// CHECK-NEXT: Return v29
// CHECK-NEXT: b11(v30) frequency=Unlikely:
// CHECK-NEXT: v31 = NewRuntimeError runtimeError=DerivedConstructorResult name="Narrow"
// CHECK-NEXT: Throw v31
// CHECK-NEXT: b12(v32) frequency=Unlikely:
// CHECK-NEXT: v33 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v33
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m7"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Negate v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mix"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=i32 flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="sum"
// CHECK-NEXT: v3 = Builtin builtin=Math
// CHECK-NEXT: v4 = Builtin builtin=MathImul
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="sum"
// CHECK-NEXT: v7 = Integer integer=31
// CHECK-NEXT: v8 = Call v4, v3, v6, v7 calleeName="Math.imul"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = BitOr v0, v10
// CHECK-NEXT: v12 = Add v9, v11
// CHECK-NEXT: v13 = Integer
// CHECK-NEXT: v14 = BitOr v12, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v15 variable=[[g_3]]
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]} results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="base"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m7"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
