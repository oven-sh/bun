type WasmHash32Function = (input_ptr: number, input_size: number) => number;
type WasmHash64Function = (input_ptr: number, input_size: number) => bigint;
type WasmSeededHash32Function = (input_ptr: number, input_size: number, seed: number) => number;
type WasmSeededHash64Function = (input_ptr: number, input_size: number, seed: bigint) => bigint;
type JSHash32Function = (input: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer) => number;
type JSHash64Function = (input: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer) => bigint;
type JSSeededHash32Function = (input: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, seed?: number) => number;
type JSSeededHash64Function = (input: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, seed?: bigint) => bigint;

type ZighashInstance = WebAssembly.WebAssemblyInstantiatedSource & {
    instance: {
        exports: {
            memory: WebAssembly.Memory,
            alloc(size: number): number,
            wyhash: WasmSeededHash64Function,
            adler32: WasmHash32Function,
            crc32: WasmHash32Function,
            cityhash32: WasmHash32Function,
            cityhash64: WasmSeededHash64Function,
            xxhash32: WasmSeededHash32Function,
            xxhash64: WasmSeededHash64Function,
            xxhash3: WasmSeededHash64Function,
            murmur32v3: WasmSeededHash32Function,
            murmur32v2: WasmSeededHash32Function,
            murmur64v2: WasmSeededHash64Function,
        };
    };
}
