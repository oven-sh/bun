const view = new DataView(new Uint8Array([255, 255, 255, 255, 0, 0, 248, 63]).buffer);
console.log(view.getInt8(0) + 1, view.getUint32(0) + 1, view.getInt32(0) + 1, typeof view.getFloat64(0, true), view.getBigInt64(0, true) + 1n, view.getFloat32(4, true) + 1);
