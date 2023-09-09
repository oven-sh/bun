declare module 'js-md4' {
    export type MD4Input = string | ArrayBuffer | Uint8Array | number[];

    interface md4 {
        /**
         * # Broken, will throw an error.
         * @deprecated Use {@link md4.hex} instead.
         */
        (input: MD4Input): never;
        /** Creates an `Md4` hasher instance. */
        create(): Md4;
        /** Shortcut for `md4.create().update(...)` */
        update(message: MD4Input): Md4;
        /** Hash `message` into a hex string. */
        hex(message: MD4Input): string;
        /** Hash `message` into an Array. */
        array(message: MD4Input): number[];
        /** Identical to {@link md4.array}. */
        digest(message: MD4Input): number[];
        /**
         * Identical to {@link md4.arrayBuffer}.
         * @deprecated Use {@link md4.arrayBuffer} instead.
         */
        buffer(message: MD4Input): ArrayBuffer;
        /** Hash `message` into an ArrayBuffer. */
        arrayBuffer(message: MD4Input): ArrayBuffer;
    }

    export type Md4 = Md4;
    declare class Md4 {
        private constructor();

        private toString(): string;
        private finalize(): void;
        private hash(): void;
        /**
         * Append `message` to the internal hash source data.
         * @returns A reference to `this` for chaining, or nothing if the instance has been finalized.
         */
        update(message: MD4Input): this | void;
        /** Hash into a hex string. Finalizes the hash. */
        hex(): string;
        /** Hash into an Array. Finalizes the hash. */
        array(): number[];
        /** Identical to {@link Md4.array}. */
        digest(): number[];
        /**
         * Identical to {@link Md4.arrayBuffer}.
         * @deprecated Use {@link Md4.arrayBuffer} instead.
         */
        buffer(): ArrayBuffer;
        /** Hash into an ArrayBuffer. Finalizes the hash. */
        arrayBuffer(): ArrayBuffer;

        private buffer8: Uint8Array;
        private blocks: Uint32Array;
        private bytes: number;
        private start: number;
        private h3: number;
        private h2: number;
        private h1: number;
        private h0: number;
        readonly hashed: boolean;
        /** If true, `update()` operations will silently fail. */
        readonly finalized: boolean;
        readonly first: boolean;
        private lastByteIndex?: number;
    }

    const md4: md4;
    export default md4;
}
