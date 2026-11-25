const hex = text => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(16)).join(".");
const made = (...points) => String.fromCodePoint(...points.map(point => point + Number(process.argv.length > 9)));
const texts = [made(0x1f600), made(0x1f64f, 0x1f64f), made(0x61, 0x1d49c), made(0x78, 0x1f600, 0x79), made(0x10428, 0x20, 0x10428)];
function count(text) { let n = 0; for (const m of text.matchAll(/(?<=[\S])/gu)) n = n * 10 + m.index; return n; }
function bars(text) { return text.replace(/(?<=.)/gsu, "|"); }
function behind(text) { const re = /(?<!x)/gu; const at = []; let m; while ((m = re.exec(text))) { at.push(m.index); if (m[0] === "") re.lastIndex++; if (at.length > 20) break; } return at.join(); }
for (let turn = 0; turn < 3; turn++) for (const text of texts) console.log("SAID", turn, hex(text), count(text), hex(bars(text)), behind(text));
