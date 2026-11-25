// Under: --aot-harden=proof-checks: what is read of a basin is asked for an object there, and views alone come to it
// The pump is a name that nothing declares: it is one function, then another. It is handed two stretches of one water each time.
const water = Float32Array.from({ length: 24 }, (_, i) => i + 0.5);
function level(into, out, count) {
    const height = out[1];
    for (let i = 0; i < count; i++)
        into[i] = height;
}
function tip(into, out) {
    into[0] = out[2];
}
function measure(into, out) {
    return into.length * 100 + out.length;
}
function day(count) {
    pump = level;
    pump(water.subarray(0, 6), water.subarray(6, 14), count);
    pump = measure;
    return pump(water.subarray(0, 6), water.subarray(6, 14), count);
}
function night(first) {
    valve = tip;
    valve(water.subarray(first, first + 4), water.subarray(16));
    valve = measure;
    return valve(water.subarray(first), water.subarray(16));
}
console.log(day(3), day(5));
console.log(night(8), night(10));
console.log(water.join(" "));
