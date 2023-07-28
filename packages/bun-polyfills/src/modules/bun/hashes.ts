import type { DigestEncoding } from 'bun';
import { NotImplementedError } from '../../utils/errors.js';
import murmur from 'murmurhash3js-revisited';
import nodecrypto from 'crypto';
import crc from '@foxglove/crc';
import adler32 from 'adler-32';
import md4, { type Md4 } from 'js-md4';
import { Fingerprint32, Fingerprint64 } from '../../../lib/farmhash/index.mjs';

export const bunHash = ((...args: Parameters<typeof Bun['hash']>): ReturnType<typeof Bun['hash']> => {
    throw new NotImplementedError('Bun.hash()', bunHash);
}) as typeof Bun['hash'];
export const bunHashProto: typeof bunHash = {
    // @ts-expect-error Force remove this property
    call: undefined,
    wyhash(data, seed?) {
        throw new NotImplementedError('Bun.hash.wyhash', this.wyhash);
    },
    adler32(data, seed?) {
        if (typeof data === 'string') return adler32.str(data, seed);
        else if (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) return adler32.buf(new Uint8Array(data), seed);
        else return adler32.buf(new Uint8Array(data.buffer), seed);
    },
    crc32(data, seed?) {
        if (data instanceof Uint8Array) return crc.crc32(data);
        if (data instanceof ArrayBuffer) return crc.crc32(new Uint8Array(data));
        if (typeof data === 'string') return crc.crc32(new TextEncoder().encode(data));
        throw new Error('unimplemented');
        // Apparently, the seed is ignored by Bun currently
        //if (!seed) return crc.crc32(data as Uint8Array);
        //crc.crc32Update(seed, data as Uint8Array);
        //return crc.crc32Final(seed);
    },
    cityHash32(data) {
        return Fingerprint32(data);
    },
    cityHash64(data) {
        return Fingerprint64(data);
    },
    // murmur32v2 (?)
    murmur32v3(data, seed = 0) {
        if (typeof data === 'string') data = new TextEncoder().encode(data);
        if (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) return murmur.x86.hash32(new Uint8Array(data), seed);
        return murmur.x86.hash32(new Uint8Array(data.buffer), seed);
    },
    murmur64v2(data, seed?) {
        throw new NotImplementedError('Bun.hash.murmur64v2', this.murmur64v2);
    }
};

abstract class BaseHash {
    constructor(algorithm?: string) {
        if (algorithm) this.#hash = nodecrypto.createHash(algorithm);
        // If no algorithm is given, expect the subclass to fully implement its own.
        else this.#hash = null;
    }
    update(data: StringOrBuffer) {
        if (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) this.#hash!.update(new Uint8Array(data));
        else this.#hash!.update(data);
        return this;
    }
    digest(encoding: DigestEncoding): string;
    digest(hashInto?: TypedArray): TypedArray;
    digest(encodingOrHashInto?: DigestEncoding | TypedArray): string | TypedArray {
        if (encodingOrHashInto === undefined) return Uint8Array.from(this.#hash!.digest());
        if (typeof encodingOrHashInto === 'string') return this.#hash!.digest(encodingOrHashInto);
        if (encodingOrHashInto instanceof BigInt64Array || encodingOrHashInto instanceof BigUint64Array) {
            throw new TypeError('Cannot digest BigInt-based TypedArray.');
        }
        encodingOrHashInto.set(this.#hash!.digest());
        return encodingOrHashInto;
    }
    static hash(data: StringOrBuffer, encoding?: DigestEncoding): string;
    static hash(data: StringOrBuffer, hashInto?: TypedArray): TypedArray;
    static hash(data: StringOrBuffer, encodingOrHashInto?: DigestEncoding | TypedArray): string | TypedArray { return ''; }
    static readonly byteLength: number;
    abstract readonly byteLength: number;
    readonly #hash: nodecrypto.Hash | null;
}

export class SHA1 extends BaseHash {
    constructor() { super('sha1'); }
    static override readonly byteLength = 20;
    override readonly byteLength = 20;
    static override hash(data: StringOrBuffer, encoding?: DigestEncoding): string;
    static override hash(data: StringOrBuffer, hashInto?: TypedArray): TypedArray;
    static override hash(data: StringOrBuffer, encodingOrHashInto?: DigestEncoding | TypedArray): string | TypedArray {
        const instance = new this(); instance.update(data);
        return typeof encodingOrHashInto === 'string' ? instance.digest(encodingOrHashInto) : instance.digest(encodingOrHashInto);
    }
}
export class MD4 extends BaseHash {
    constructor() {
        super(); //! Not supported by nodecrypto
        this.#hash = md4.create();
    } 
    static override readonly byteLength = 16;
    override readonly byteLength = 16;
    static override hash(data: StringOrBuffer, encoding?: DigestEncoding): string;
    static override hash(data: StringOrBuffer, hashInto?: TypedArray): TypedArray;
    static override hash(data: StringOrBuffer, encodingOrHashInto?: DigestEncoding | TypedArray): string | TypedArray {
        const instance = new this(); instance.update(data);
        return typeof encodingOrHashInto === 'string' ? instance.digest(encodingOrHashInto) : instance.digest(encodingOrHashInto);
    }
    override update(data: StringOrBuffer) {
        if (typeof data === 'string') this.#hash.update(data);
        else if (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) this.#hash.update(new Uint8Array(data));
        else this.#hash.update(new Uint8Array(data.buffer));
        return this;
    }
    override digest(encoding: DigestEncoding): string;
    override digest(hashInto?: TypedArray): TypedArray;
    override digest(encodingOrHashInto?: DigestEncoding | TypedArray): string | TypedArray {
        if (encodingOrHashInto === undefined) return new Uint8Array(this.#hash.arrayBuffer());
        if (typeof encodingOrHashInto === 'string') {
            if (encodingOrHashInto === 'hex') return this.#hash.hex();
            if (encodingOrHashInto === 'base64') return Buffer.from(this.#hash.hex(), 'hex').toString('base64');
            const err = new Error(`Unsupported encoding: ${encodingOrHashInto as string}`);
            Error.captureStackTrace(err, this.digest);
            throw err;
        }
        if (encodingOrHashInto instanceof BigInt64Array || encodingOrHashInto instanceof BigUint64Array) {
            throw new TypeError('Cannot digest BigInt-based TypedArray.');
        }
        encodingOrHashInto.set(this.#hash.array());
        return encodingOrHashInto;
    }
    readonly #hash: Md4;
}
export class MD5 extends BaseHash {
    constructor() { super('md5'); }
    static override readonly byteLength = 16;
    override readonly byteLength = 16;
    static override hash(data: StringOrBuffer, encoding?: DigestEncoding): string;
    static override hash(data: StringOrBuffer, hashInto?: TypedArray): TypedArray;
    static override hash(data: StringOrBuffer, encodingOrHashInto?: DigestEncoding | TypedArray): string | TypedArray {
        const instance = new this(); instance.update(data);
        return typeof encodingOrHashInto === 'string' ? instance.digest(encodingOrHashInto) : instance.digest(encodingOrHashInto);
    }
}
export class SHA224 extends BaseHash {
    constructor() { super('sha224'); }
    static override readonly byteLength = 28;
    override readonly byteLength = 28;
    static override hash(data: StringOrBuffer, encoding?: DigestEncoding): string;
    static override hash(data: StringOrBuffer, hashInto?: TypedArray): TypedArray;
    static override hash(data: StringOrBuffer, encodingOrHashInto?: DigestEncoding | TypedArray): string | TypedArray {
        const instance = new this(); instance.update(data);
        return typeof encodingOrHashInto === 'string' ? instance.digest(encodingOrHashInto) : instance.digest(encodingOrHashInto);
    }
}
export class SHA512 extends BaseHash {
    constructor() { super('sha512'); }
    static override readonly byteLength = 64;
    override readonly byteLength = 64;
    static override hash(data: StringOrBuffer, encoding?: DigestEncoding): string;
    static override hash(data: StringOrBuffer, hashInto?: TypedArray): TypedArray;
    static override hash(data: StringOrBuffer, encodingOrHashInto?: DigestEncoding | TypedArray): string | TypedArray {
        const instance = new this(); instance.update(data);
        return typeof encodingOrHashInto === 'string' ? instance.digest(encodingOrHashInto) : instance.digest(encodingOrHashInto);
    }
}
export class SHA384 extends BaseHash {
    constructor() { super('sha384'); }
    static override readonly byteLength = 48;
    override readonly byteLength = 48;
    static override hash(data: StringOrBuffer, encoding?: DigestEncoding): string;
    static override hash(data: StringOrBuffer, hashInto?: TypedArray): TypedArray;
    static override hash(data: StringOrBuffer, encodingOrHashInto?: DigestEncoding | TypedArray): string | TypedArray {
        const instance = new this(); instance.update(data);
        return typeof encodingOrHashInto === 'string' ? instance.digest(encodingOrHashInto) : instance.digest(encodingOrHashInto);
    }
}
export class SHA256 extends BaseHash {
    constructor() { super('sha256'); }
    static override readonly byteLength = 32;
    override readonly byteLength = 32;
    static override hash(data: StringOrBuffer, encoding?: DigestEncoding): string;
    static override hash(data: StringOrBuffer, hashInto?: TypedArray): TypedArray;
    static override hash(data: StringOrBuffer, encodingOrHashInto?: DigestEncoding | TypedArray): string | TypedArray {
        const instance = new this(); instance.update(data);
        return typeof encodingOrHashInto === 'string' ? instance.digest(encodingOrHashInto) : instance.digest(encodingOrHashInto);
    }
}
export class SHA512_256 extends BaseHash {
    constructor() { super('sha512-256'); }
    static override readonly byteLength = 32;
    override readonly byteLength = 32;
    static override hash(data: StringOrBuffer, encoding?: DigestEncoding): string;
    static override hash(data: StringOrBuffer, hashInto?: TypedArray): TypedArray;
    static override hash(data: StringOrBuffer, encodingOrHashInto?: DigestEncoding | TypedArray): string | TypedArray {
        const instance = new this(); instance.update(data);
        return typeof encodingOrHashInto === 'string' ? instance.digest(encodingOrHashInto) : instance.digest(encodingOrHashInto);
    }
}
