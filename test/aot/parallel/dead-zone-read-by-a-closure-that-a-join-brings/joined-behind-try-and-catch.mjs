const c = process.argv.length > 100;
let f;
try { f = () => x; JSON.parse(c ? "1" : "{"); } catch { f = () => y; }
let before;
try { before = f(); } catch (error) { before = error.name; }
let x = 1, y = 2;
console.log(before, f());
