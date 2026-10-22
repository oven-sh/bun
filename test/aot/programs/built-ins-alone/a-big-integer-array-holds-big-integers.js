const view = new BigInt64Array([1n, -1n]);
console.log(typeof view[0], view[0] + 1n, new BigUint64Array(view.buffer)[1]);
