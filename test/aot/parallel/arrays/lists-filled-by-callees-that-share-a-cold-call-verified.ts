// Flags: --aot-check=verify-each-pass
// Each list is made here, filled by a callee and then read. Many callees end with the same cold call, which the compiler moves into one function of its own;
// the tests of the list that JSON.stringify need not repeat rest on the callee not keeping the list.
const show = (v: any, d = 0): string => { if (v === null) return "null"; if (v === undefined) return "u"; const t = typeof v; if (t === "number") return Object.is(v, -0) ? "-0" : String(v); if (t === "string") return JSON.stringify(v); if (t === "function") return "fn"; if (t !== "object") return String(v); if (d > 2) return ".."; if (Array.isArray(v)) { const p = []; for (let i = 0; i < Math.min(v.length, 12); i++) p.push(i in v ? show(v[i], d + 1) : "_"); return "[" + p.join() + "]" + v.length; } return "{" + Object.keys(v).map(k => k + ":" + show(v[k], d + 1)).join() + "}"; };
function rest(...r: any[]) { return r; }
function hidden(a: any, f: (a: any) => void) { f(a); }
const attempt = (f: () => unknown): string => { try { return show(f()); } catch (e) { return "THROWS " + (e as Error).name; } };


function m1281(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1281() { const a: any = [{ n: 1 }, { n: 2 }]; m1281(a); return Object.keys(a).slice(0, 6); }
function m1282(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1282() { const a: any = [{ n: 1 }, { n: 2 }]; m1282(a); return 0 in a; }
function m1283(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1283() { const a: any = [{ n: 1 }, { n: 2 }]; m1283(a); return 5000 in a; }
function m1284(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1284() { const a: any = [{ n: 1 }, { n: 2 }]; m1284(a); return JSON.stringify(a).slice(0, 40); }
function m1285(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1285() { const a: any = [{ n: 1 }, { n: 2 }]; m1285(a); return String(a).slice(0, 30); }
function m1286(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1286() { const a: any = [{ n: 1 }, { n: 2 }]; m1286(a); return a.flat().length; }
function m1287(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1287() { const a: any = [{ n: 1 }, { n: 2 }]; m1287(a); return a.toSorted().slice(0, 3); }
function m1288(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1288() { const a: any = [{ n: 1 }, { n: 2 }]; m1288(a); return a.toReversed().slice(0, 3); }
function m1289(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1289() { const a: any = [{ n: 1 }, { n: 2 }]; m1289(a); return a.with(0, 'w').slice(0, 2); }
function m1290(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1290() { const a: any = [{ n: 1 }, { n: 2 }]; m1290(a); return a.pop(); }
function m1291(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1291() { const a: any = [{ n: 1 }, { n: 2 }]; m1291(a); return a.shift(); }
function m1292(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1292() { const a: any = [{ n: 1 }, { n: 2 }]; m1292(a); return a.push(5); }
function m1293(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1293() { const a: any = [{ n: 1 }, { n: 2 }]; m1293(a); return (a[0] = 'st', a[0]); }
function m1294(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1294() { const a: any = [{ n: 1 }, { n: 2 }]; m1294(a); return (a[1] = 1, a.slice(0, 3)); }
function m1295(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1295() { const a: any = [{ n: 1 }, { n: 2 }]; m1295(a); return a.sort().slice(0, 3); }
function m1296(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1296() { const a: any = [{ n: 1 }, { n: 2 }]; m1296(a); return a.fill(0, 0, 2).slice(0, 3); }
function m1297(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1297() { const a: any = [{ n: 1 }, { n: 2 }]; m1297(a); return Math.max.apply(null, a.slice(0, 3)); }
function m1298(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1298() { const a: any = [{ n: 1 }, { n: 2 }]; m1298(a); return rest(...a).length; }
function m1299(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1299() { const a: any = [{ n: 1 }, { n: 2 }]; m1299(a); return Array.isArray(a); }
function m1300(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1300() { const a: any = [{ n: 1 }, { n: 2 }]; m1300(a); return Object.hasOwn(a, 1); }
function m1301(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1301() { const a: any = [{ n: 1 }, { n: 2 }]; m1301(a); return a.copyWithin(0, 1, 2).slice(0, 3); }
function m1302(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.shift(); } function g1302() { const a: any = [{ n: 1 }, { n: 2 }]; m1302(a); return (() => { let t = 0; for (let i = 0; i < a.length; i++) if (typeof a[i] === 'number') t += a[i]; return t; })(); }
function m1303(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1303() { const a: any = [{ n: 1 }, { n: 2 }]; m1303(a); return a[0]; }
function m1304(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1304() { const a: any = [{ n: 1 }, { n: 2 }]; m1304(a); return a[1]; }
function m1305(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1305() { const a: any = [{ n: 1 }, { n: 2 }]; m1305(a); return a[7]; }
function m1306(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1306() { const a: any = [{ n: 1 }, { n: 2 }]; m1306(a); return a[a.length - 1]; }
function m1307(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1307() { const a: any = [{ n: 1 }, { n: 2 }]; m1307(a); return a[5000]; }
function m1308(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1308() { const a: any = [{ n: 1 }, { n: 2 }]; m1308(a); return a.at(0); }
function m1309(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1309() { const a: any = [{ n: 1 }, { n: 2 }]; m1309(a); return a.at(-1); }
function m1310(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1310() { const a: any = [{ n: 1 }, { n: 2 }]; m1310(a); return a.at(1); }
function m1311(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1311() { const a: any = [{ n: 1 }, { n: 2 }]; m1311(a); return a.length; }
function m1312(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1312() { const a: any = [{ n: 1 }, { n: 2 }]; m1312(a); return a.includes(2); }
function m1313(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1313() { const a: any = [{ n: 1 }, { n: 2 }]; m1313(a); return a.includes(undefined); }
function m1314(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1314() { const a: any = [{ n: 1 }, { n: 2 }]; m1314(a); return a.includes("far"); }
function m1315(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1315() { const a: any = [{ n: 1 }, { n: 2 }]; m1315(a); return a.indexOf(2); }
function m1316(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1316() { const a: any = [{ n: 1 }, { n: 2 }]; m1316(a); return a.indexOf("far"); }
function m1317(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1317() { const a: any = [{ n: 1 }, { n: 2 }]; m1317(a); return a.lastIndexOf("far"); }
function m1318(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1318() { const a: any = [{ n: 1 }, { n: 2 }]; m1318(a); return a.join().length; }
function m1319(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1319() { const a: any = [{ n: 1 }, { n: 2 }]; m1319(a); return a.join("-").slice(0, 40); }
function m1320(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1320() { const a: any = [{ n: 1 }, { n: 2 }]; m1320(a); return a.slice(0, 4); }
function m1321(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1321() { const a: any = [{ n: 1 }, { n: 2 }]; m1321(a); return a.slice(-2); }
function m1322(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1322() { const a: any = [{ n: 1 }, { n: 2 }]; m1322(a); return a.slice().length; }
function m1323(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1323() { const a: any = [{ n: 1 }, { n: 2 }]; m1323(a); return a.concat([1]).length; }
function m1324(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1324() { const a: any = [{ n: 1 }, { n: 2 }]; m1324(a); return (() => { let n = 0, s = ''; for (const x of a) { if (n++ < 9) s += show(x); } return s + n; })(); }
function m1325(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1325() { const a: any = [{ n: 1 }, { n: 2 }]; m1325(a); return (() => { let s = ''; for (let i = 0; i < a.length && i < 9; i++) s += show(a[i]); return s; })(); }
function m1326(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1326() { const a: any = [{ n: 1 }, { n: 2 }]; m1326(a); return (() => { let n = 0, s = ''; a.forEach((x: any) => { if (n++ < 9) s += show(x); }); return s + n; })(); }
function m1327(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1327() { const a: any = [{ n: 1 }, { n: 2 }]; m1327(a); return a.map((x: any) => x).slice(0, 5); }
function m1328(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1328() { const a: any = [{ n: 1 }, { n: 2 }]; m1328(a); return a.filter((x: any) => x !== 2).slice(0, 5); }
function m1329(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1329() { const a: any = [{ n: 1 }, { n: 2 }]; m1329(a); return a.reduce((s: any, x: any) => s + 1, 0); }
function m1330(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1330() { const a: any = [{ n: 1 }, { n: 2 }]; m1330(a); return a.some((x: any) => x === "far"); }
function m1331(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1331() { const a: any = [{ n: 1 }, { n: 2 }]; m1331(a); return a.every((x: any) => x !== undefined); }
function m1332(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1332() { const a: any = [{ n: 1 }, { n: 2 }]; m1332(a); return a.find((x: any) => x === "far"); }
function m1333(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1333() { const a: any = [{ n: 1 }, { n: 2 }]; m1333(a); return a.findIndex((x: any) => x === undefined); }
function m1334(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1334() { const a: any = [{ n: 1 }, { n: 2 }]; m1334(a); return a.findLast(() => true); }
function m1335(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1335() { const a: any = [{ n: 1 }, { n: 2 }]; m1335(a); return a.findLastIndex((x: any) => x !== undefined); }
function m1336(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1336() { const a: any = [{ n: 1 }, { n: 2 }]; m1336(a); return [...a].length; }
function m1337(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1337() { const a: any = [{ n: 1 }, { n: 2 }]; m1337(a); return [...a].slice(0, 4); }
function m1338(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1338() { const a: any = [{ n: 1 }, { n: 2 }]; m1338(a); return (() => { const [p, q, r] = a; return [p, q, r]; })(); }
function m1339(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1339() { const a: any = [{ n: 1 }, { n: 2 }]; m1339(a); return (() => { const [p, ...r] = a; return [p, r.length]; })(); }
function m1340(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1340() { const a: any = [{ n: 1 }, { n: 2 }]; m1340(a); return Array.from(a).length; }
function m1341(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1341() { const a: any = [{ n: 1 }, { n: 2 }]; m1341(a); return [...a.keys()].length; }
function m1342(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1342() { const a: any = [{ n: 1 }, { n: 2 }]; m1342(a); return [...a.entries()].slice(0, 2); }
function m1343(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1343() { const a: any = [{ n: 1 }, { n: 2 }]; m1343(a); return Object.keys(a).slice(0, 6); }
function m1344(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1344() { const a: any = [{ n: 1 }, { n: 2 }]; m1344(a); return 0 in a; }
function m1345(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1345() { const a: any = [{ n: 1 }, { n: 2 }]; m1345(a); return 5000 in a; }
function m1346(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1346() { const a: any = [{ n: 1 }, { n: 2 }]; m1346(a); return JSON.stringify(a).slice(0, 40); }
function m1347(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1347() { const a: any = [{ n: 1 }, { n: 2 }]; m1347(a); return String(a).slice(0, 30); }
function m1348(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1348() { const a: any = [{ n: 1 }, { n: 2 }]; m1348(a); return a.flat().length; }
function m1349(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1349() { const a: any = [{ n: 1 }, { n: 2 }]; m1349(a); return a.toSorted().slice(0, 3); }
function m1350(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1350() { const a: any = [{ n: 1 }, { n: 2 }]; m1350(a); return a.toReversed().slice(0, 3); }
function m1351(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1351() { const a: any = [{ n: 1 }, { n: 2 }]; m1351(a); return a.with(0, 'w').slice(0, 2); }
function m1352(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1352() { const a: any = [{ n: 1 }, { n: 2 }]; m1352(a); return a.pop(); }
function m1353(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1353() { const a: any = [{ n: 1 }, { n: 2 }]; m1353(a); return a.shift(); }
function m1354(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1354() { const a: any = [{ n: 1 }, { n: 2 }]; m1354(a); return a.push(5); }
function m1355(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1355() { const a: any = [{ n: 1 }, { n: 2 }]; m1355(a); return (a[0] = 'st', a[0]); }
function m1356(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1356() { const a: any = [{ n: 1 }, { n: 2 }]; m1356(a); return (a[1] = 1, a.slice(0, 3)); }
function m1357(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1357() { const a: any = [{ n: 1 }, { n: 2 }]; m1357(a); return a.sort().slice(0, 3); }
function m1358(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1358() { const a: any = [{ n: 1 }, { n: 2 }]; m1358(a); return a.fill(0, 0, 2).slice(0, 3); }
function m1359(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1359() { const a: any = [{ n: 1 }, { n: 2 }]; m1359(a); return Math.max.apply(null, a.slice(0, 3)); }
function m1360(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1360() { const a: any = [{ n: 1 }, { n: 2 }]; m1360(a); return rest(...a).length; }
function m1361(a: any) { for (let i = 0; i < 120; i++) a.push(i); a.unshift("u", "v"); } function g1361() { const a: any = [{ n: 1 }, { n: 2 }]; m1361(a); return Array.isArray(a); }
const ALL: [string, () => unknown][] = [["g1281", g1281], ["g1282", g1282], ["g1283", g1283], ["g1284", g1284], ["g1285", g1285], ["g1286", g1286], ["g1287", g1287], ["g1288", g1288], ["g1289", g1289], ["g1290", g1290], ["g1291", g1291], ["g1292", g1292], ["g1293", g1293], ["g1294", g1294], ["g1295", g1295], ["g1296", g1296], ["g1297", g1297], ["g1298", g1298], ["g1299", g1299], ["g1300", g1300], ["g1301", g1301], ["g1302", g1302], ["g1303", g1303], ["g1304", g1304], ["g1305", g1305], ["g1306", g1306], ["g1307", g1307], ["g1308", g1308], ["g1309", g1309], ["g1310", g1310], ["g1311", g1311], ["g1312", g1312], ["g1313", g1313], ["g1314", g1314], ["g1315", g1315], ["g1316", g1316], ["g1317", g1317], ["g1318", g1318], ["g1319", g1319], ["g1320", g1320], ["g1321", g1321], ["g1322", g1322], ["g1323", g1323], ["g1324", g1324], ["g1325", g1325], ["g1326", g1326], ["g1327", g1327], ["g1328", g1328], ["g1329", g1329], ["g1330", g1330], ["g1331", g1331], ["g1332", g1332], ["g1333", g1333], ["g1334", g1334], ["g1335", g1335], ["g1336", g1336], ["g1337", g1337], ["g1338", g1338], ["g1339", g1339], ["g1340", g1340], ["g1341", g1341], ["g1342", g1342], ["g1343", g1343], ["g1344", g1344], ["g1345", g1345], ["g1346", g1346], ["g1347", g1347], ["g1348", g1348], ["g1349", g1349], ["g1350", g1350], ["g1351", g1351], ["g1352", g1352], ["g1353", g1353], ["g1354", g1354], ["g1355", g1355], ["g1356", g1356], ["g1357", g1357], ["g1358", g1358], ["g1359", g1359], ["g1360", g1360], ["g1361", g1361]];
for (let turn = 0; turn < 2; turn++) for (const [name, f] of ALL) { const r = attempt(f); console.log(turn + " " + name + ": " + r); }
