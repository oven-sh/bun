import { endianness } from 'node:os';
import util from 'node:util';
import koffi from 'koffi';
import type bunffi from 'bun:ffi';

const LE = endianness() === 'LE';

koffi.alias('f32', 'float');
koffi.alias('f64', 'double');
koffi.alias('i8', 'int8_t');
koffi.alias('i16', 'int16_t');
koffi.alias('i32', 'int32_t');
koffi.alias('i64', 'int64_t');
koffi.alias('u8', 'uint8_t');
koffi.alias('u16', 'uint16_t');
koffi.alias('u32', 'uint32_t');
koffi.alias('u64', 'uint64_t');
koffi.alias('usize', 'uint64_t');
koffi.alias('callback', 'void*');
koffi.alias('function', 'void*');
koffi.alias('cstring', 'uint8_t*');
koffi.alias('pointer', 'void*');
koffi.alias('ptr', 'void*');

function bunffiTypeToKoffiType(type: bunffi.FFITypeOrString = 'void'): string {
    if (typeof type === 'number') return ffi.FFIType[type];
    else return type;
}

enum FFIType {
    char = 0,
    i8 = 1,
    int8_t = 1,
    u8 = 2,
    uint8_t = 2,
    i16 = 3,
    int16_t = 3,
    u16 = 4,
    uint16_t = 4,
    int = 5,
    i32 = 5,
    int32_t = 5,
    u32 = 6,
    uint32_t = 6,
    i64 = 7,
    int64_t = 7,
    u64 = 8,
    uint64_t = 8,
    f64 = 9,
    double = 9,
    f32 = 10,
    float = 10,
    bool = 11,
    ptr = 12,
    pointer = 12,
    void = 13,
    cstring = 14,
    i64_fast = 15,
    u64_fast = 16,
    function = 17,
};

/**
 * Koffi/Node.js don't seem to have a way to get the pointer address of a value, so we have to track them ourselves,
 * while also making up fake addresses for values that are created on the JS side, but ensuring that they're unique.
 */
const ptrsToValues = new Map<bunffi.Pointer, unknown>();
let fakePtr = 4;

const ffi = {
    dlopen<Fns extends Record<string, bunffi.Narrow<bunffi.FFIFunction>>>(name: string, symbols: Fns) {
        const lib = koffi.load(name);
        const outsyms = {} as bunffi.ConvertFns<typeof symbols>;
        for (const [sym, def] of Object.entries(symbols) as [string, bunffi.FFIFunction][]) {
            const returnType = bunffiTypeToKoffiType(def.returns);
            const argTypes = def.args?.map(bunffiTypeToKoffiType) ?? [];
            const rawfn = lib.func(
                sym,
                returnType,
                argTypes,
            );
            Reflect.set(
                outsyms,
                sym,
                function(...args: any[]) {
                    args.forEach((arg, i) => {
                        if (typeof arg === 'number' && (argTypes[i] === 'ptr' || argTypes[i] === 'pointer')) {
                            const ptrVal = ptrsToValues.get(arg);
                            if (!ptrVal) throw new Error(
                                `Untracked pointer ${arg} in ffi function call ${sym}, this polyfill is limited to pointers obtained through the same instance of the ffi module.`
                            );
                            args[i] = ptrVal;
                        }
                    });
                    const rawret = rawfn(...args);
                    if (returnType === 'function' || returnType === 'pointer' || returnType === 'ptr') {
                        const ptrAddr = Number(koffi.address(rawret));
                        ptrsToValues.set(ptrAddr, rawret);
                        return ptrAddr;
                    }
                    if (returnType === 'cstring') {
                        const ptrAddr = Number(koffi.address(rawret));
                        ptrsToValues.set(ptrAddr, rawret);
                        return new ffi.CString(ptrAddr);
                    }
                    return rawret;
                }
            );
        }
        return {
            close() { lib.unload(); },
            symbols: outsyms,
        };
    },
    linkSymbols<Fns extends Record<string, bunffi.Narrow<bunffi.FFIFunction>>>(symbols: Fns) {
        const linked = {} as bunffi.ConvertFns<typeof symbols>;
        for (const [sym, def] of Object.entries(symbols) as [string, bunffi.FFIFunction][]) {
            if (!def.ptr) throw new Error('ffi.linkSymbols requires a non-null pointer');
            Reflect.set(linked, sym, ffi.CFunction(def as typeof def & { ptr: bunffi.Pointer }));
        }
        return {
            close() {},
            symbols: linked,
        };
    },
    viewSource(symsOrCb, isCb) {
        // Impossible to polyfill, but we preserve the important properties of the function:
        // 1. Returns string if the 2nd argument is true, or an array of strings if it's false/unset.
        // 2. The string array has the same length as there are keys in the given symbols object.
        const stub = '/* [native code] */' as const;
        return isCb ? stub : Object.keys(symsOrCb).map(() => stub) as any; // any cast to suppress type error due to non-overload syntax
    },
    toBuffer(ptr, bOff, bLen) {
        const arraybuffer = this.toArrayBuffer(ptr, bOff, bLen);
        return Buffer.from(arraybuffer);
    },
    //! Problem: these arraybuffer views are not mapped to the native memory, so they can't be used to modify the memory.
    toArrayBuffer(ptr, byteOff?, byteLen?) {
        const view = ptrsToValues.get(ptr);
        if (!view) throw new Error(
            `Untracked pointer ${ptr} in ffi.toArrayBuffer, this polyfill is limited to pointers obtained through the same instance of the ffi module.`
        );
        if (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) return view as ArrayBuffer; // ?
        if (util.types.isExternal(view)) {
            if (byteLen === undefined) {
                let bytes = [], byte, off = 0;
                do {
                    byte = koffi.decode(view, off++, 'unsigned char[]', 1);
                    bytes.push(byte[0]);
                } while (byte[0]);
                bytes.pop();
                return new Uint8Array(bytes).buffer as ArrayBuffer; // ?
            } else {
                return koffi.decode(view, byteOff ?? 0, 'unsigned char[]', byteLen).buffer;
            }
        }
        if (byteOff === undefined) return (view as DataView).buffer;
        return (view as DataView).buffer.slice(byteOff, byteOff + (byteLen ?? (view as DataView).byteLength));
    },
    ptr(view, byteOffset = 0) {
        const known = [...ptrsToValues.entries()].find(([_, v]) => v === view);
        if (known) return known[0];
        const ptr = fakePtr;
        fakePtr += (view.byteLength + 3) & ~0x3;
        if (!byteOffset) {
            ptrsToValues.set(ptr, view);
            return ptr;
        } else {
            const view2 = new DataView(
                (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) ? view : view.buffer,
                byteOffset, view.byteLength
            );
            ptrsToValues.set(ptr + byteOffset, view2);
            return ptr + byteOffset;
        }
    },
    read: {
        f32(ptr, bOff = 0) {
            const view = ptrsToValues.get(ptr);
            if (!view) throw new Error(
                `Untracked pointer ${ptr} in ffi.read.f32, this polyfill is limited to pointers obtained through the same instance of the ffi module.`
            );
            if (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) return new DataView(view).getFloat32(bOff, LE);
            return koffi.decode(view, bOff, 'f32');
        },
        f64(ptr, bOff = 0) {
            const view = ptrsToValues.get(ptr);
            if (!view) throw new Error(
                `Untracked pointer ${ptr} in ffi.read.f64, this polyfill is limited to pointers obtained through the same instance of the ffi module.`
            );
            if (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) return new DataView(view).getFloat64(bOff, LE);
            return koffi.decode(view, bOff, 'f64');
        },
        i8(ptr, bOff = 0) {
            const view = ptrsToValues.get(ptr);
            if (!view) throw new Error(
                `Untracked pointer ${ptr} in ffi.read.i8, this polyfill is limited to pointers obtained through the same instance of the ffi module.`
            );
            if (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) return new DataView(view).getInt8(bOff);
            return koffi.decode(view, bOff, 'i8');
        },
        i16(ptr, bOff = 0) {
            const view = ptrsToValues.get(ptr);
            if (!view) throw new Error(
                `Untracked pointer ${ptr} in ffi.read.i16, this polyfill is limited to pointers obtained through the same instance of the ffi module.`
            );
            if (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) return new DataView(view).getInt16(bOff, LE);
            return koffi.decode(view, bOff, 'i16');
        },
        i32(ptr, bOff = 0) {
            const view = ptrsToValues.get(ptr);
            if (!view) throw new Error(
                `Untracked pointer ${ptr} in ffi.read.i32, this polyfill is limited to pointers obtained through the same instance of the ffi module.`
            );
            if (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) return new DataView(view).getInt32(bOff, LE);
            return koffi.decode(view, bOff, 'i32');
        },
        i64(ptr, bOff = 0) {
            const view = ptrsToValues.get(ptr);
            if (!view) throw new Error(
                `Untracked pointer ${ptr} in ffi.read.i64, this polyfill is limited to pointers obtained through the same instance of the ffi module.`
            );
            if (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) return new DataView(view).getBigInt64(bOff, LE);
            return koffi.decode(view, bOff, 'i64');
        },
        intptr(ptr, bOff = 0) {
            return this.i32(ptr, bOff);
        },
        ptr(ptr, bOff = 0) {
            const u64 = this.u64(ptr, bOff);
            const masked = u64 & 0b11111111_11111111_11111111_11111111_11111111_11111111_00000111_00000000n;
            return Number(masked);
        },
        u8(ptr, bOff = 0) {
            const view = ptrsToValues.get(ptr);
            if (!view) throw new Error(
                `Untracked pointer ${ptr} in ffi.read.u8, this polyfill is limited to pointers obtained through the same instance of the ffi module.`
            );
            if (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) return new DataView(view).getUint8(bOff);
            return koffi.decode(view, bOff, 'u8');
        },
        u16(ptr, bOff = 0) {
            const view = ptrsToValues.get(ptr);
            if (!view) throw new Error(
                `Untracked pointer ${ptr} in ffi.read.u16, this polyfill is limited to pointers obtained through the same instance of the ffi module.`
            );
            if (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) return new DataView(view).getUint16(bOff, LE);
            return koffi.decode(view, bOff, 'u16');
        },
        u32(ptr, bOff = 0) {
            const view = ptrsToValues.get(ptr);
            if (!view) throw new Error(
                `Untracked pointer ${ptr} in ffi.read.u32, this polyfill is limited to pointers obtained through the same instance of the ffi module.`
            );
            if (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) return new DataView(view).getUint32(bOff, LE);
            return koffi.decode(view, bOff, 'u32');
        },
        u64(ptr, bOff = 0) {
            const view = ptrsToValues.get(ptr);
            if (!view) throw new Error(
                `Untracked pointer ${ptr} in ffi.read.u64, this polyfill is limited to pointers obtained through the same instance of the ffi module.`
            );
            if (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) return new DataView(view).getBigUint64(bOff, LE);
            return koffi.decode(view, bOff, 'u64');
        },
    },
    suffix:
        process.platform === 'darwin' ? '.dylib' :
        (process.platform === 'win32' ? '.dll' : '.so'),
    CString: class CString extends String implements bunffi.CString {
        constructor(ptr: bunffi.Pointer, bOff?: number, bLen?: number) {
            const buf = ffi.toBuffer(ptr, bOff, bLen);
            const str = buf.toString('ascii');
            super(str);
            this.ptr = ptr;
            this.#buffer = buf.buffer as ArrayBuffer; // ?
        }
        close() {};
        ptr: bunffi.Pointer;
        byteOffset?: number;
        byteLength?: number;
        #buffer: ArrayBuffer;
        get arrayBuffer(): ArrayBuffer { return this.#buffer; };
    },
    CFunction(sym): CallableFunction & { close(): void; } {
        if (!sym.ptr) throw new Error('ffi.CFunction requires a non-null pointer');
        const fnName = `anonymous__${sym.ptr.toString(16).replaceAll('.', '_')}`
        const fnSig = koffi.proto(fnName, bunffiTypeToKoffiType(sym.returns), sym.args?.map(bunffiTypeToKoffiType) ?? []);
        const fnPtr = ptrsToValues.get(sym.ptr);
        if (!fnPtr) throw new Error(
            `Untracked pointer ${sym.ptr} in ffi.CFunction, this polyfill is limited to pointers obtained through the same instance of the ffi module.`
        );
        const fn = koffi.decode(fnPtr, fnSig);
        fn.close = () => {};
        return fn;
    },
    // TODO
    JSCallback: class JSCallback implements bunffi.JSCallback {
        constructor(cb: (...args: any[]) => any, def: bunffi.FFIFunction) {}
        readonly ptr!: bunffi.Pointer | null;
        readonly threadsafe!: boolean;
        close() {};
    },
    FFIType,
} satisfies typeof bunffi;
export default ffi;
