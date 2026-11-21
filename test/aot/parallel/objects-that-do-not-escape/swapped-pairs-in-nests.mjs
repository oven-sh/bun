// A version of a loop is built again, and the elements of the merged array are constants of the walk that was undone (the build stopped under --aot-harden=proof-checks).
let s = 0;
function f1(A) { let p = [0.5, 1], s = 0; for (let z = 0; z < 2; z++) for (let i = 0; i < A.length; i++) { p = [p[1], p[0]]; s ^= A[i + 1]; } return s; }
function f2(A) { for (let z = 0; z < 2; z++) for (let i = 0; i < A.length; i++) s = Math.max(s, A[i]); }
for (const A of [[1, 2, 3, 4, 5, 6], [1, 2, 't', 4, 5, 6], [1, , 3, 4], [0.5, 1, 2.5, 3], [2147483647, 1, 2147483647, 5], [1, 2, 3, null, 5], [undefined, 1], [], [1, 2, 3, { valueOf() { } }, 5, 6], [-0, 1, -0]]) { console.log(f1(A)); try { f2(A); } catch (e) { } console.log(s); }
