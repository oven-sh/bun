'use strict';
// COUNT: operation:operationAOTCompareGreater <= 8
// COUNT: operation:operationAOTCompareLess <= 8
// COUNT: operation:operationAOTCompareGreaterEq <= 8
// COUNT: operation:operationAOTCompareLessEq <= 8
// Half of the rows lack the name, some hold null or a truth: what is read is held against a fraction by each of the four relations, on either side.
const rows = JSON.parse('[' + Array.from({ length: 60 }, (_, i) => ['{"a":' + i + '}', '{"b":1}', '{"a":null}', '{"a":true}', '{"a":' + (i + 0.5) + '}'][i % 5]).join() + ']');
function count(which) {
    let c = 0;
    for (let i = 0; i < rows.length; i++) {
        const a = rows[i].a;
        if (which === 0 ? a > 0.5 : which === 1 ? a < 0.5 : which === 2 ? a >= 0.5 : which === 3 ? a <= 0.5 : which === 4 ? 0.5 > a : which === 5 ? 0.5 < a : which === 6 ? 0.5 >= a : 0.5 <= a) c++;
    }
    return c;
}
function greater() { let c = 0; for (let i = 0; i < rows.length; i++) if (rows[i].a > 10.5) c++; return c; }
function less() { let c = 0; for (let i = 0; i < rows.length; i++) if (rows[i].a < 10.5) c++; return c; }
function greaterEq() { let c = 0; for (let i = 0; i < rows.length; i++) if (rows[i].a >= 0.5) c++; return c; }
function lessEq() { let c = 0; for (let i = 0; i < rows.length; i++) if (rows[i].a <= 0.5) c++; return c; }
const out = []; for (let t = 0; t < 4; t++) { out.push(greater(), less(), greaterEq(), lessEq()); for (let which = 0; which < 8; which++) out.push(count(JSON.parse(String(which)))); }
console.log(out.join());
