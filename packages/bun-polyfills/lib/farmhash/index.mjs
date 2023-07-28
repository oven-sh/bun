// @ts-check
/// <reference types="emscripten" />
import instantiate from './build/farmhash.mjs';

/**
 * @type {EmscriptenModule & {
 *  _Fingerprint32: (bufptr: number, buflen: number) => number,
 *  _Fingerprint64: (bufptr: number, buflen: number) => bigint,
 * }}
 */
const farmhash = await instantiate();
const encoder = new TextEncoder();

/**
 * @param {string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer} input
 */
export function Fingerprint32(input) {
    let length = 0;
    if (typeof input === 'string') {
        length = encoder.encodeInto(input, farmhash.HEAPU8).written;
    } else {
        length = input.byteLength;
        farmhash.HEAPU8.set(new Uint8Array(ArrayBuffer.isView(input) ? input.buffer : input), 0);
    }
    return farmhash._Fingerprint32(0, length) >>> 0;
}
/**
 * @param {string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer} input
 */
export function Fingerprint64(input) {
    let length = 0;
    if (typeof input === 'string') {
        length = encoder.encodeInto(input, farmhash.HEAPU8).written;
    } else {
        length = input.byteLength;
        farmhash.HEAPU8.set(new Uint8Array(ArrayBuffer.isView(input) ? input.buffer : input), 0);
    }
    return BigInt.asUintN(64, farmhash._Fingerprint64(0, length));
}
