// Nothing else in the program names node:dgram.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
let found;
for (const n of ["node:dgram"]) try { found = await import(n); } catch {}
let answer;
try { answer = typeof (found)?.createSocket; } catch (error) { answer = error.code; }
console.log(answer);
