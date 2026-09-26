// Scenario 2: a loop-heavy kernel that reaches the FTL tier, and a checksum.
// Integer and plain double arithmetic only: the result does not depend on the libm.
// Run: jsc --useDollarVM=1 ftl.js
var sawFTL = 0;
function mix(a, b) {
    a = (a ^ b) | 0;
    a = Math.imul(a, 0x01000193);
    a ^= a >>> 15;
    return a | 0;
}
function kernel(arr, seed) {
    var h = seed | 0;
    var d = 0.5;
    for (var i = 0; i < arr.length; i++) {
        h = mix(h, arr[i]);
        d = d * 1.0000001 + (h & 255) / 1024;
        if (d > 1e6)
            d -= 1e6;
        arr[i] = (arr[i] + h) | 0;
    }
    if ($vm.ftlTrue())
        sawFTL++;
    return (h ^ (d | 0)) | 0;
}
noInline(kernel);
var arr = new Int32Array(4096);
for (var i = 0; i < arr.length; i++)
    arr[i] = Math.imul(i, 2654435761 | 0);
var sum = 0;
for (var n = 0; n < 12000; n++)
    sum = (sum + kernel(arr, n)) | 0;
var tail = 0;
for (var i = 0; i < arr.length; i++)
    tail = (Math.imul(tail, 31) + arr[i]) | 0;
// The compilers run on threads of their own. On a machine that is busy they may come late:
// the kernel runs on, on a copy that is not part of the checksum, until the FTL code is
// there (or for 200 times the rounds from above, which is where the scenario fails).
var scratch = new Int32Array(arr);
for (var n = 0; n < 2400000 && !(sawFTL && numberOfDFGCompiles(kernel) >= 2); n++)
    kernel(scratch, n);
print("ftl checksum " + (sum >>> 0).toString(16) + " " + (tail >>> 0).toString(16));
print("ftl tier reached " + (sawFTL > 0) + ", optimizing compiles of kernel " + (numberOfDFGCompiles(kernel) >= 2));
