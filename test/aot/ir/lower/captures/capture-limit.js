// RUN: lower
// STATISTIC: MaxCapturesHits = 1
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[environment]] = NewObject {{*}}layout=[[layout]]
// CHECK: [[c0]] = Call
// CHECK: = NewClosure [[environment]] function=
// CHECK: = NewClosure [[c0]] function=
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: captures=[{type=env [[layout]] flags=[IsFromCompiler]}] thisType
// CHECK-LABEL: function {{*}}name="one"
// CHECK: captures=[{type=anything}] thisType

export function f(g) {
  const c0 = g(), c1 = g(), c2 = g(), c3 = g(), c4 = g(), c5 = g(), c6 = g(), c7 = g(), c8 = g(), c9 = g();
  const c10 = g(), c11 = g(), c12 = g(), c13 = g(), c14 = g(), c15 = g(), c16 = g(), c17 = g(), c18 = g(), c19 = g();
  const c20 = g(), c21 = g(), c22 = g(), c23 = g(), c24 = g(), c25 = g(), c26 = g(), c27 = g(), c28 = g(), c29 = g();
  const c30 = g(), c31 = g(), c32 = g(), c33 = g(), c34 = g(), c35 = g(), c36 = g(), c37 = g(), c38 = g(), c39 = g();
  const c40 = g(), c41 = g(), c42 = g(), c43 = g(), c44 = g(), c45 = g(), c46 = g(), c47 = g(), c48 = g(), c49 = g();
  const c50 = g(), c51 = g(), c52 = g(), c53 = g(), c54 = g(), c55 = g(), c56 = g(), c57 = g(), c58 = g(), c59 = g();
  const c60 = g(), c61 = g(), c62 = g(), c63 = g(), c64 = g(), c65 = g(), c66 = g(), c67 = g(), c68 = g(), c69 = g();
  const c70 = g(), c71 = g(), c72 = g(), c73 = g(), c74 = g(), c75 = g(), c76 = g(), c77 = g(), c78 = g(), c79 = g();
  const c80 = g(), c81 = g(), c82 = g(), c83 = g(), c84 = g(), c85 = g(), c86 = g(), c87 = g(), c88 = g(), c89 = g();
  const c90 = g(), c91 = g(), c92 = g(), c93 = g(), c94 = g(), c95 = g(), c96 = g(), c97 = g(), c98 = g(), c99 = g();
  const c100 = g(), c101 = g(), c102 = g(), c103 = g(), c104 = g(), c105 = g(), c106 = g(), c107 = g(), c108 = g(), c109 = g();
  const c110 = g(), c111 = g(), c112 = g(), c113 = g(), c114 = g(), c115 = g(), c116 = g(), c117 = g(), c118 = g(), c119 = g();
  const c120 = g(), c121 = g(), c122 = g(), c123 = g(), c124 = g(), c125 = g(), c126 = g(), c127 = g(), c128 = g(), c129 = g();
  const c130 = g(), c131 = g(), c132 = g(), c133 = g(), c134 = g(), c135 = g(), c136 = g(), c137 = g(), c138 = g(), c139 = g();
  const c140 = g(), c141 = g(), c142 = g(), c143 = g(), c144 = g(), c145 = g(), c146 = g(), c147 = g(), c148 = g(), c149 = g();
  const c150 = g(), c151 = g(), c152 = g(), c153 = g(), c154 = g(), c155 = g(), c156 = g(), c157 = g(), c158 = g(), c159 = g();
  const c160 = g(), c161 = g(), c162 = g(), c163 = g(), c164 = g(), c165 = g(), c166 = g(), c167 = g(), c168 = g(), c169 = g();
  const c170 = g(), c171 = g(), c172 = g(), c173 = g(), c174 = g(), c175 = g(), c176 = g(), c177 = g(), c178 = g(), c179 = g();
  const c180 = g(), c181 = g(), c182 = g(), c183 = g(), c184 = g(), c185 = g(), c186 = g(), c187 = g(), c188 = g(), c189 = g();
  const c190 = g(), c191 = g(), c192 = g(), c193 = g(), c194 = g(), c195 = g(), c196 = g(), c197 = g(), c198 = g(), c199 = g();
  const c200 = g(), c201 = g(), c202 = g(), c203 = g(), c204 = g(), c205 = g(), c206 = g(), c207 = g(), c208 = g(), c209 = g();
  const c210 = g(), c211 = g(), c212 = g(), c213 = g(), c214 = g(), c215 = g(), c216 = g(), c217 = g(), c218 = g(), c219 = g();
  const c220 = g(), c221 = g(), c222 = g(), c223 = g(), c224 = g(), c225 = g(), c226 = g(), c227 = g(), c228 = g(), c229 = g();
  const c230 = g(), c231 = g(), c232 = g(), c233 = g(), c234 = g(), c235 = g(), c236 = g(), c237 = g(), c238 = g(), c239 = g();
  const c240 = g(), c241 = g(), c242 = g(), c243 = g(), c244 = g(), c245 = g(), c246 = g(), c247 = g(), c248 = g(), c249 = g();
  const c250 = g(), c251 = g(), c252 = g(), c253 = g(), c254 = g(), c255 = g(), c256 = g(), c257 = g(), c258 = g(), c259 = g();
  const c260 = g(), c261 = g(), c262 = g(), c263 = g(), c264 = g(), c265 = g(), c266 = g(), c267 = g(), c268 = g(), c269 = g();
  const c270 = g(), c271 = g(), c272 = g(), c273 = g(), c274 = g(), c275 = g(), c276 = g(), c277 = g(), c278 = g(), c279 = g();
  const c280 = g(), c281 = g(), c282 = g(), c283 = g(), c284 = g(), c285 = g(), c286 = g(), c287 = g(), c288 = g(), c289 = g();
  const c290 = g(), c291 = g(), c292 = g(), c293 = g(), c294 = g(), c295 = g(), c296 = g(), c297 = g(), c298 = g(), c299 = g();
  const sum = () =>
    c0 + c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8 + c9 +
    c10 + c11 + c12 + c13 + c14 + c15 + c16 + c17 + c18 + c19 +
    c20 + c21 + c22 + c23 + c24 + c25 + c26 + c27 + c28 + c29 +
    c30 + c31 + c32 + c33 + c34 + c35 + c36 + c37 + c38 + c39 +
    c40 + c41 + c42 + c43 + c44 + c45 + c46 + c47 + c48 + c49 +
    c50 + c51 + c52 + c53 + c54 + c55 + c56 + c57 + c58 + c59 +
    c60 + c61 + c62 + c63 + c64 + c65 + c66 + c67 + c68 + c69 +
    c70 + c71 + c72 + c73 + c74 + c75 + c76 + c77 + c78 + c79 +
    c80 + c81 + c82 + c83 + c84 + c85 + c86 + c87 + c88 + c89 +
    c90 + c91 + c92 + c93 + c94 + c95 + c96 + c97 + c98 + c99 +
    c100 + c101 + c102 + c103 + c104 + c105 + c106 + c107 + c108 + c109 +
    c110 + c111 + c112 + c113 + c114 + c115 + c116 + c117 + c118 + c119 +
    c120 + c121 + c122 + c123 + c124 + c125 + c126 + c127 + c128 + c129 +
    c130 + c131 + c132 + c133 + c134 + c135 + c136 + c137 + c138 + c139 +
    c140 + c141 + c142 + c143 + c144 + c145 + c146 + c147 + c148 + c149 +
    c150 + c151 + c152 + c153 + c154 + c155 + c156 + c157 + c158 + c159 +
    c160 + c161 + c162 + c163 + c164 + c165 + c166 + c167 + c168 + c169 +
    c170 + c171 + c172 + c173 + c174 + c175 + c176 + c177 + c178 + c179 +
    c180 + c181 + c182 + c183 + c184 + c185 + c186 + c187 + c188 + c189 +
    c190 + c191 + c192 + c193 + c194 + c195 + c196 + c197 + c198 + c199 +
    c200 + c201 + c202 + c203 + c204 + c205 + c206 + c207 + c208 + c209 +
    c210 + c211 + c212 + c213 + c214 + c215 + c216 + c217 + c218 + c219 +
    c220 + c221 + c222 + c223 + c224 + c225 + c226 + c227 + c228 + c229 +
    c230 + c231 + c232 + c233 + c234 + c235 + c236 + c237 + c238 + c239 +
    c240 + c241 + c242 + c243 + c244 + c245 + c246 + c247 + c248 + c249 +
    c250 + c251 + c252 + c253 + c254 + c255 + c256 + c257 + c258 + c259 +
    c260 + c261 + c262 + c263 + c264 + c265 + c266 + c267 + c268 + c269 +
    c270 + c271 + c272 + c273 + c274 + c275 + c276 + c277 + c278 + c279 +
    c280 + c281 + c282 + c283 + c284 + c285 + c286 + c287 + c288 + c289 +
    c290 + c291 + c292 + c293 + c294 + c295 + c296 + c297 + c298 + c299;
  const one = () => c0;
  return [sum, one];
}
