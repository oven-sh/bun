// Pure-JSC repro: interleaved delete+add on a plain object with N properties
// is O(N) per operation for N in roughly [130, 4096].
//
// Works in the jsc shell or any runtime: only uses Date.now() for timing.

function churn(N, rounds) {
    var o = {};
    for (var i = 0; i < N; i++) o["k" + i] = i;
    var keys = new Array(N);
    for (var i = 0; i < N; i++) keys[i] = "k" + i;
    var tail = 0;
    var t0 = Date.now();
    for (var r = 0; r < rounds; r++) {
        var old = keys[tail];
        delete o[old];
        var nk = "key" + r;
        o[nk] = tail;
        keys[tail] = nk;
        tail = (tail + 1) % N;
    }
    return Date.now() - t0;
}

var rounds = 2000;
print("N\tms for " + rounds + " delete+add");
var sizes = [64, 128, 200, 500, 1000, 2000, 4096, 4097, 8192];
for (var i = 0; i < sizes.length; i++) {
    var N = sizes[i];
    churn(N, 100); // warmup
    print(N + "\t" + churn(N, rounds));
}
