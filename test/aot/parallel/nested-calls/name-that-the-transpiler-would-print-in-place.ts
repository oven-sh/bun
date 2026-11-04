function a1() { const loopA = (n: number): number => (n <= 0 ? 0 : 1 + loopA(n - 1)); return loopA; }
function a2() { const loopB = (n: number): number => (n <= 0 ? 0 : 1 + loopB(n - 1)); return [loopB]; }
function a3() { const loopC = (n: number): number => (n <= 0 ? 0 : 1 + loopC(n - 1)); return loopC(3); }
function a4() { const plainD = (n: number): number => n; return plainD; }
function a5() { const loopE = (n: number): number => (n <= 0 ? 0 : 1 + loopE(n - 1)); const other = 1; return loopE; }
console.log(a1().name, a2()[0].name, a3(), a4().name, a5().name);
