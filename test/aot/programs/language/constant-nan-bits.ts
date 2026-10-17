// A NaN that the build computes has the bits of the one NaN that JavaScript source can name, whatever machine the build ran on: on x86-64 the hardware's own 0 / 0 has its sign bit set.
const view = new DataView(new ArrayBuffer(8));
view.setFloat64(0, 0 / 0);
console.log(view.getBigUint64(0).toString(16));
view.setFloat64(0, NaN);
console.log(view.getBigUint64(0).toString(16));
console.log(new BigUint64Array(new Float64Array([0 / 0]).buffer)[0]!.toString(16), new Uint32Array(new Float32Array([0 / 0]).buffer)[0]!.toString(16));
const nothing = 0 / 0;
const doubles = new Float64Array(2);
doubles[0] = nothing;
doubles.fill(nothing, 1);
console.log(new BigUint64Array(doubles.buffer).join(), Object.is(nothing, NaN), nothing !== nothing);
