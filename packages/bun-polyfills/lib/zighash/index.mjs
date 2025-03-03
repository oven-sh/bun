// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { instance } = /** @type {ZighashInstance} */(
    await WebAssembly.instantiate(
        fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'zighash.wasm')),
        {
            env: {
                /** @param {any} x */
                print(x) { console.log(x); },
            },
        }
    )
);
const exports = instance.exports;
const mem = exports.memory;
const memview = {
    get u8() { return new Uint8Array(mem.buffer); },
    get u16() { return new Uint16Array(mem.buffer); },
    get u32() { return new Uint32Array(mem.buffer); },
    get u64() { return new BigUint64Array(mem.buffer); },
    get i8() { return new Int8Array(mem.buffer); },
    get i16() { return new Int16Array(mem.buffer); },
    get i32() { return new Int32Array(mem.buffer); },
    get i64() { return new BigInt64Array(mem.buffer); },
    get f32() { return new Float32Array(mem.buffer); },
    get f64() { return new Float64Array(mem.buffer); },
};

const nullptr = { ptr: -1, size: 0 };
const encoder = new TextEncoder();

const allocBuffer = (
    /** @type {ArrayBufferView | ArrayBuffer | SharedArrayBuffer} */ buf,
    /** @type {boolean=} */ nullTerminate = false,
) => {
    const size = buf.byteLength + +nullTerminate;
    if (size === 0) return nullptr;
    const ptr = exports.alloc(size);
    if (ptr === -1) throw new Error('WASM memory allocation failed');
    const u8heap = memview.u8;
    u8heap.set(new Uint8Array(ArrayBuffer.isView(buf) ? buf.buffer : buf), ptr);
    if (nullTerminate) u8heap[ptr + buf.byteLength] = 0;
    return { ptr, size };
};
const allocString = (
    /** @type {string} */ str,
    /** @type {boolean=} */ nullTerminate = true,
) => {
    const strbuf = encoder.encode(str);
    return allocBuffer(strbuf, nullTerminate);
};

/** @type {JSSeededHash64Function} */
export function wyhash(input = '', seed = 0n) {
    const { ptr, size } = typeof input === 'string' ? allocString(input, false) : allocBuffer(input);
    return BigInt.asUintN(64, exports.wyhash(ptr, size, seed));
}
/** @type {JSHash32Function} */
export function adler32(input = '') {
    const { ptr, size } = typeof input === 'string' ? allocString(input, false) : allocBuffer(input);
    return exports.adler32(ptr, size) >>> 0;
}
/** @type {JSHash32Function} */
export function crc32(input = '') {
    const { ptr, size } = typeof input === 'string' ? allocString(input, false) : allocBuffer(input);
    return exports.crc32(ptr, size) >>> 0;
}
/** @type {JSHash32Function} */
export function cityhash32(input = '') {
    const { ptr, size } = typeof input === 'string' ? allocString(input, false) : allocBuffer(input);
    return exports.cityhash32(ptr, size) >>> 0;
}
/** @type {JSSeededHash64Function} */
export function cityhash64(input = '', seed = 0n) {
    const { ptr, size } = typeof input === 'string' ? allocString(input, false) : allocBuffer(input);
    return BigInt.asUintN(64, exports.cityhash64(ptr, size, seed));
}
/** @type {JSSeededHash32Function} */
export function xxhash32(input = '', seed = 0) {
  const { ptr, size } = typeof input === 'string' ? allocString(input, false) : allocBuffer(input);
  return exports.xxhash32(ptr, size, seed)
}
/** @type {JSSeededHash64Function} */
export function xxhash64(input = '', seed = 0n) {
    const { ptr, size } = typeof input === 'string' ? allocString(input, false) : allocBuffer(input);
    return BigInt.asUintN(64, exports.xxhash64(ptr, size, seed));
}
/** @type {JSSeededHash64Function} */
export function xxhash3(input = '', seed = 0n) {
    const { ptr, size } = typeof input === 'string' ? allocString(input, false) : allocBuffer(input);
    return BigInt.asUintN(64, exports.xxhash3(ptr, size, seed));
}
/** @type {JSSeededHash32Function} */
export function murmur32v3(input = '', seed = 0) {
    const { ptr, size } = typeof input === 'string' ? allocString(input, false) : allocBuffer(input);
    return exports.murmur32v3(ptr, size, seed); //! Bun doesn't unsigned-cast this one, likely unintended but for now we'll do the same
}
/** @type {JSSeededHash32Function} */
export function murmur32v2(input = '', seed = 0) {
    const { ptr, size } = typeof input === 'string' ? allocString(input, false) : allocBuffer(input);
    return exports.murmur32v2(ptr, size, seed); //! Bun doesn't unsigned-cast this one, likely unintended but for now we'll do the same
}
/** @type {JSSeededHash64Function} */
export function murmur64v2(input = '', seed = 0n) {
    const { ptr, size } = typeof input === 'string' ? allocString(input, false) : allocBuffer(input);
    return BigInt.asUintN(64, exports.murmur64v2(ptr, size, seed));
}
