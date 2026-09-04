// Bootstrap du runtime Bun-Elixir
globalThis.console = { log: globalThis.__rust_log.log };

// Primordials Node.js
// Génération dynamique de primordials Node.js
const uncurryThis = (fn) => {
    if (typeof fn !== 'function') {
        throw new TypeError('uncurryThis must be called with a function, got ' + typeof fn);
    }
    return (thisArg, ...args) => Reflect.apply(fn, thisArg, args);
};

const prims = {
    uncurryThis,
    SafeMap: Map, SafeSet: Set, SafePromise: Promise, SafeWeakMap: WeakMap,
    SafeWeakRef: typeof WeakRef !== 'undefined' ? WeakRef : class { constructor(val) { this.val = val; } deref() { return this.val; } },
    globalThis: globalThis,
    SafeArrayIterator: class {
        constructor(iterable) {
            this.iterable = iterable;
        }
        *[Symbol.iterator]() {
            yield* this.iterable;
        }
    }
};

const targets = [
    ['Object', Object],
    ['Array', Array],
    ['String', String],
    ['Number', Number],
    ['Boolean', Boolean],
    ['Date', Date],
    ['RegExp', RegExp],
    ['Error', Error],
    ['TypeError', TypeError],
    ['RangeError', RangeError],
    ['SyntaxError', SyntaxError],
    ['URIError', URIError],
    ['Map', Map],
    ['Set', Set],
    ['WeakMap', WeakMap],
    ['WeakSet', WeakSet],
    ['ArrayBuffer', ArrayBuffer],
    ['DataView', DataView],
    ['Promise', Promise],
    ['Symbol', Symbol],
    ['BigInt', BigInt],
    ['Function', Function],
    ['AggregateError', AggregateError],
    ['Uint8Array', Uint8Array],
    ['Uint16Array', Uint16Array],
    ['Float32Array', Float32Array],
    ['Float64Array', Float64Array],
    ['Int8Array', Int8Array],
    ['Int16Array', Int16Array],
    ['Int32Array', Int32Array],
    ['Uint32Array', Uint32Array],
    ['Uint8ClampedArray', Uint8ClampedArray]
];
if (typeof BigInt64Array !== 'undefined') targets.push(['BigInt64Array', BigInt64Array]);
if (typeof BigUint64Array !== 'undefined') targets.push(['BigUint64Array', BigUint64Array]);
if (typeof SharedArrayBuffer !== 'undefined') targets.push(['SharedArrayBuffer', SharedArrayBuffer]);
if (typeof WeakRef !== 'undefined') targets.push(['WeakRef', WeakRef]);

// Récupération de TypedArray
const TypedArray = Object.getPrototypeOf(Uint8Array);
targets.push(['TypedArray', TypedArray]);

for (const [name, ctor] of targets) {
    prims[name] = ctor;
    if (ctor.prototype) {
        prims[name + 'Prototype'] = ctor.prototype;
        
        // Propriétés du prototype
        for (const key of Reflect.ownKeys(ctor.prototype)) {
            if (key === 'constructor') continue;
            try {
                const desc = Object.getOwnPropertyDescriptor(ctor.prototype, key);
                if (!desc) continue;
                let keyStr;
                if (typeof key === 'symbol') {
                    let descStr = key.description || '';
                    if (descStr.startsWith('Symbol.')) {
                        descStr = descStr.slice(7);
                    }
                    keyStr = descStr ? 'Symbol' + descStr.charAt(0).toUpperCase() + descStr.slice(1) : '';
                } else {
                    keyStr = key.charAt(0).toUpperCase() + key.slice(1);
                }
                
                if (!keyStr) continue;

                if (typeof desc.value === 'function') {
                    prims[`${name}Prototype${keyStr}`] = uncurryThis(desc.value);
                }
                if (typeof desc.get === 'function') {
                    prims[`${name}PrototypeGet${keyStr}`] = uncurryThis(desc.get);
                }
                if (typeof desc.set === 'function') {
                    prims[`${name}PrototypeSet${keyStr}`] = uncurryThis(desc.set);
                }
            } catch(e) {}
        }
    }
    
    // Propriétés statiques
    for (const key of Reflect.ownKeys(ctor)) {
        if (['length', 'name', 'prototype', 'arguments', 'caller'].includes(key)) continue;
        try {
            const desc = Object.getOwnPropertyDescriptor(ctor, key);
            if (!desc) continue;
            let keyStr;
            if (typeof key === 'symbol') {
                let descStr = key.description || '';
                if (descStr.startsWith('Symbol.')) {
                    descStr = descStr.slice(7);
                }
                keyStr = descStr ? 'Symbol' + descStr.charAt(0).toUpperCase() + descStr.slice(1) : '';
            } else {
                keyStr = key.charAt(0).toUpperCase() + key.slice(1);
            }

            if (!keyStr) continue;

            if (typeof desc.value === 'function') {
                prims[`${name}${keyStr}`] = desc.value;
            }
        } catch(e) {}
    }
}

// Remplacer/compléter par les versions spécifiques attendues
prims.ArrayIsArray = Array.isArray;
prims.ErrorCaptureStackTrace = Error.captureStackTrace || ((e) => {});
prims.JSONStringify = JSON.stringify;
prims.MathAbs = Math.abs;
prims.MathMax = Math.max;
prims.MathMin = Math.min;
prims.MathFloor = Math.floor;
prims.MathRound = Math.round;
prims.MathPow = Math.pow;
prims.MathSign = Math.sign;
prims.MathTrunc = Math.trunc;
prims.ReflectOwnKeys = Reflect.ownKeys;
prims.ReflectApply = Reflect.apply;
prims.ReflectGet = Reflect.get;
prims.ReflectSet = Reflect.set;
prims.ReflectHas = Reflect.has;
prims.ReflectConstruct = Reflect.construct;
prims.ReflectDefineProperty = Reflect.defineProperty;
prims.ReflectDeleteProperty = Reflect.deleteProperty;
prims.ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
prims.ReflectGetPrototypeOf = Reflect.getPrototypeOf;
prims.ReflectIsExtensible = Reflect.isExtensible;
prims.ReflectPreventExtensions = Reflect.preventExtensions;
prims.ReflectSetPrototypeOf = Reflect.setPrototypeOf;
prims.ObjectPrototypeHasOwnProperty = uncurryThis(Object.prototype.hasOwnProperty);
prims.SymbolReplace = Symbol.replace;
prims.SymbolSplit = Symbol.split;
prims.SymbolIterator = Symbol.iterator;
prims.SymbolAsyncIterator = Symbol.asyncIterator;
prims.SymbolSearch = Symbol.search;
prims.SymbolMatch = Symbol.match;
prims.SymbolMatchAll = Symbol.matchAll;
prims.SymbolToStringTag = Symbol.toStringTag;
prims.SymbolHasInstance = Symbol.hasInstance;
prims.SymbolSpecies = Symbol.species;
prims.SymbolToPrimitive = Symbol.toPrimitive;
prims.SymbolUnscopables = Symbol.unscopables;
prims.SymbolDispose = Symbol.dispose || Symbol('Symbol.dispose');
prims.ArrayFromAsync = Array.fromAsync || ((iterable) => Promise.all(Array.from(iterable)));
prims.Boolean = Boolean;

prims.ArrayPrototypePushApply = (a, b) => Array.prototype.push.apply(a, b);
prims.ObjectPrototypeIsPrototypeOf = (o, ...args) => Object.prototype.isPrototypeOf.call(o, ...args);
prims.ArrayPrototypeToSorted = (a, ...args) => {
    if (typeof a.toSorted === 'function') {
        return a.toSorted(...args);
    }
    return [...a].sort(...args);
};
prims.TypedArrayFrom = (constructor, ...args) => constructor.from(...args);
prims.TypedArrayOf = (constructor, ...args) => constructor.of(...args);
prims.TypedArrayPrototypeIncludes = (a, ...args) => Uint8Array.prototype.includes.call(a, ...args);
prims.TypedArrayPrototypeSet = (a, ...args) => Uint8Array.prototype.set.call(a, ...args);
prims.TypedArrayPrototypeGetSymbolToStringTag = (val) => {
    if (val && typeof val === 'object') {
        if (val.constructor && val.constructor.name === 'Buffer') return 'Uint8Array';
        const toStringName = Object.prototype.toString.call(val).slice(8, -1);
        if (toStringName.endsWith('Array') && toStringName !== 'Array') return toStringName;
    }
    return undefined;
};

globalThis.primordials = prims;

// Polyfills TextEncoder & TextDecoder UTF-8 robustes
globalThis.TextEncoder = class TextEncoder {
    get encoding() { return 'utf-8'; }
    encode(str = '') {
        const buf = [];
        for (let i = 0; i < str.length; i++) {
            let code = str.charCodeAt(i);
            if (code < 0x80) {
                buf.push(code);
            } else if (code < 0x800) {
                buf.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
            } else if (code < 0xd800 || code >= 0xe000) {
                buf.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            } else {
                i++;
                let nextCode = str.charCodeAt(i);
                let surrogateValue = 0x10000 + (((code & 0x3ff) << 10) | (nextCode & 0x3ff));
                buf.push(
                    0xf0 | (surrogateValue >> 18),
                    0x80 | ((surrogateValue >> 12) & 0x3f),
                    0x80 | ((surrogateValue >> 6) & 0x3f),
                    0x80 | (surrogateValue & 0x3f)
                );
            }
        }
        return new Uint8Array(buf);
    }
};

globalThis.TextDecoder = class TextDecoder {
    constructor(label = 'utf-8', options = {}) {
        this.encoding = 'utf-8';
        this.fatal = options.fatal || false;
        this.ignoreBOM = options.ignoreBOM || false;
    }
    decode(arr, options = {}) {
        if (!arr) return '';
        const view = new Uint8Array(arr.buffer || arr);
        let str = '';
        let i = 0;
        while (i < view.length) {
            let byte = view[i++];
            if (byte < 0x80) {
                str += String.fromCharCode(byte);
            } else if (byte < 0xe0) {
                let byte2 = view[i++];
                str += String.fromCharCode(((byte & 0x1f) << 6) | (byte2 & 0x3f));
            } else if (byte < 0xf0) {
                let byte2 = view[i++];
                let byte3 = view[i++];
                str += String.fromCharCode(((byte & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f));
            } else {
                let byte2 = view[i++];
                let byte3 = view[i++];
                let byte4 = view[i++];
                let codepoint = ((byte & 0x07) << 18) | ((byte2 & 0x3f) << 12) | ((byte3 & 0x3f) << 6) | (byte4 & 0x3f);
                codepoint -= 0x10000;
                str += String.fromCharCode(0xd800 | (codepoint >> 10), 0xdc00 | (codepoint & 0x3ff));
            }
        }
        return str;
    }
};

globalThis.__transfer_registry = {};
globalThis.__pending_fetches = new Map();
globalThis.__pending_processes = new Map();

// Fetch API
globalThis.fetch = function(url, options = {}) {
    return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).substring(7);
        globalThis.__pending_fetches.set(id, { resolve, reject });
        globalThis.sendToElixir({ 
            type: 'fetch', 
            url: url, 
            id: id,
            method: options.method || 'GET',
            headers: options.headers || {},
            body: options.body || null
        });
    });
};

globalThis.__resolve_fetch = function(id, data, error) {
    const pending = globalThis.__pending_fetches.get(id);
    if (pending) {
        if (error) {
            pending.reject(new Error(error));
        } else {
            const binaryData = data || globalThis.__transfer_registry[id];
            pending.resolve({ 
                text: () => Promise.resolve(new TextDecoder().decode(binaryData)),
                json: () => {
                    const text = new TextDecoder().decode(binaryData);
                    return Promise.resolve(JSON.parse(text));
                },
                arrayBuffer: () => Promise.resolve(binaryData.buffer)
            });
            delete globalThis.__transfer_registry[id];
        }
        globalThis.__pending_fetches.delete(id);
    }
};

// Process API
globalThis.__elixir_spawn = function(cmd, args = []) {
    const id = Math.random().toString(36).substring(7);
    const callbacks = { stdout: [], stderr: [], close: [] };
    globalThis.__pending_processes.set(id, callbacks);
    globalThis.sendToElixir({ type: 'spawn', cmd: cmd, args: args, id: id });
    return { on: (event, cb) => { if (callbacks[event]) callbacks[event].push(cb); } };
};

globalThis.__resolve_process = function(id, event, data) {
    const callbacks = globalThis.__pending_processes.get(id);
    if (callbacks && callbacks[event]) {
        callbacks[event].forEach(cb => cb(data));
        if (event === 'close') globalThis.__pending_processes.delete(id);
    }
};

// Bindings infrastructure
globalThis.internalBinding = function(name) {
    if (name === 'errors') return {
        exitCodes: { kGenericUserError: 1 },
        noSideEffectsToString: (x) => String(x),
        triggerUncaughtException: (err) => { throw err; }
    };
    if (name === 'blob') return {
        createBlob: () => {},
        createBlobFromFilePath: () => {},
        concat: () => {},
        getDataObject: () => {}
    };
    if (name === 'timers') return {
        immediateInfo: new Int32Array(3),
        timeoutInfo: new Int32Array(2)
    };
    if (name === 'task_queue') return {
        tickInfo: new Int32Array(5),
        runMicrotasks: () => {},
        setTickCallback: () => {},
        enqueueMicrotask: (fn) => Promise.resolve().then(fn),
        promiseRejectEvents: {
            kPromiseRejectWithNoHandler: 0,
            kPromiseHandlerAddedAfterReject: 1,
            kPromiseRejectAfterResolved: 2,
            kPromiseResolveAfterResolved: 3
        },
        setPromiseRejectCallback: () => {}
    };
    if (name === 'async_wrap') {
        const fields = new Uint32Array(10);
        const id_fields = new Float64Array(10);
        return {
            setCallbackTrampoline: () => {},
            async_hook_fields: fields,
            async_id_fields: id_fields,
            execution_async_resources: [],
            pushAsyncContext: () => {},
            popAsyncContext: () => {},
            executionAsyncResource: () => null,
            clearAsyncIdStack: () => {},
            registerDestroyHook: () => {},
            constants: {
                kInit: 0, kBefore: 1, kAfter: 2, kDestroy: 3, kTotals: 4, kPromiseResolve: 5,
                kCheck: 6, kExecutionAsyncId: 7, kAsyncIdCounter: 8, kTriggerAsyncId: 9,
                kDefaultTriggerAsyncId: 10, kStackLength: 11, kUsesExecutionAsyncResource: 12
            }
        };
    }
    if (name === 'constants') return { 
        fs: {
            F_OK: 0,
            R_OK: 4,
            W_OK: 2,
            X_OK: 1,
            COPYFILE_EXCL: 1,
            COPYFILE_FICLONE: 2,
            COPYFILE_FICLONE_FORCE: 4,
            O_APPEND: 8,
            O_CREAT: 256,
            O_EXCL: 1024,
            O_RDONLY: 0,
            O_RDWR: 2,
            O_SYNC: 128,
            O_TRUNC: 512,
            O_WRONLY: 1,
            S_IFBLK: 24576,
            S_IFCHR: 8192,
            S_IFDIR: 16384,
            S_IFIFO: 4096,
            S_IFLNK: 40960,
            S_IFMT: 61440,
            S_IFREG: 32768,
            S_IFSOCK: 49152,
            UV_FS_SYMLINK_DIR: 1,
            UV_FS_SYMLINK_JUNCTION: 2,
            UV_DIRENT_UNKNOWN: 0,
            UV_DIRENT_FILE: 1,
            UV_DIRENT_DIR: 2,
            UV_DIRENT_LINK: 3,
            UV_DIRENT_FIFO: 4,
            UV_DIRENT_SOCKET: 5,
            UV_DIRENT_CHAR: 6,
            UV_DIRENT_BLOCK: 7
        },
        os: {
            signals: { SIGINT: 2, SIGTERM: 15 },
            errno: {
                EISDIR: 21
            }
        }
    };
    if (name === 'fs') return { 
        readFileUtf8: (p, flags) => {
            console.log("--- NATIVE FS: readFileUtf8 called for path:", p, "flags:", flags);
            try {
                const res = globalThis.__rust_fs.read(p);
                console.log("--- NATIVE FS: readFileUtf8 success, length:", res ? res.length : 0);
                return res;
            } catch(e) {
                console.log("--- NATIVE FS: readFileUtf8 error:", e);
                throw e;
            }
        },
        writeFileUtf8: (p, c) => globalThis.__rust_fs.write(p, c),
        mkdir: (p) => globalThis.__rust_fs.mkdir(p),
        unlink: (p) => globalThis.__rust_fs.rm(p)
    };
    if (name === 'os') return {
        getHostname: () => globalThis.__rust_os.hostname(),
        getFreeMem: () => globalThis.__rust_os.freemem(),
        getTotalMem: () => globalThis.__rust_os.totalmem(),
        getCPUs: () => [],
        getOSInformation: () => ["Windows_NT", "Windows 10", "10.0.19045"]
    };
    if (name === 'config') return {
        hasIntl: false
    };
    if (name === 'encoding_binding') return {
        encodeInto: (source, dest) => {
            let srcArr = typeof source === 'string' ? new TextEncoder().encode(source) : source;
            let len = Math.min(srcArr.length, dest.length);
            for (let i = 0; i < len; i++) dest[i] = srcArr[i];
            return { read: len, written: len };
        },
        encodeIntoResults: (read, written) => {
            return { read, written };
        },
        encodeUtf8String: (str) => {
            return new TextEncoder().encode(str);
        },
        decodeUTF8: (buf) => {
            return new TextDecoder().decode(buf);
        }
    };
    if (name === 'string_decoder') return {
        encodings: {
            utf8: 1,
            utf16le: 2,
            latin1: 3,
            ascii: 4,
            base64: 5,
            hex: 6
        }
    };
    if (name === 'buffer') {
        const b64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        const b64Lookup = new Uint8Array(256);
        for (let i = 0; i < b64Chars.length; i++) b64Lookup[b64Chars.charCodeAt(i)] = i;

        return {
            kMaxLength: 2147483647,
            createUnsafeArrayBuffer: (size) => new ArrayBuffer(size),
            setDetachKey: () => {},
            utf8Slice: (buf, start, end) => {
                return new TextDecoder().decode(buf.subarray(start, end));
            },
            latin1Slice: (buf, start, end) => {
                let s = '';
                for (let i = start; i < end; i++) s += String.fromCharCode(buf[i]);
                return s;
            },
            asciiSlice: (buf, start, end) => {
                let s = '';
                for (let i = start; i < end; i++) s += String.fromCharCode(buf[i] & 0x7f);
                return s;
            },
            hexSlice: (buf, start, end) => {
                let hex = '';
                for (let i = start; i < end; i++) {
                    let h = buf[i].toString(16);
                    if (h.length < 2) h = '0' + h;
                    hex += h;
                }
                return hex;
            },
            base64Slice: (buf, start, end) => {
                const bytes = buf.subarray(start, end);
                let result = '';
                const len = bytes.length;
                for (let i = 0; i < len; i += 3) {
                    const b1 = bytes[i];
                    const b2 = i + 1 < len ? bytes[i + 1] : 0;
                    const b3 = i + 2 < len ? bytes[i + 2] : 0;
                    const c1 = b1 >> 2;
                    const c2 = ((b1 & 3) << 4) | (b2 >> 4);
                    const c3 = ((b2 & 15) << 2) | (b3 >> 6);
                    const c4 = b3 & 63;
                    result += b64Chars.charAt(c1) + b64Chars.charAt(c2);
                    result += i + 1 < len ? b64Chars.charAt(c3) : '=';
                    result += i + 2 < len ? b64Chars.charAt(c4) : '=';
                }
                return result;
            },
            base64urlSlice: (buf, start, end) => {
                const b64 = globalThis.internalBinding('buffer').base64Slice(buf, start, end);
                return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
            },
            ucs2Slice: (buf, start, end) => {
                let s = '';
                for (let i = start; i < end - 1; i += 2) {
                    s += String.fromCharCode(buf[i] | (buf[i + 1] << 8));
                }
                return s;
            },
            utf8WriteStatic: (buf, offset, length, string) => {
                const bytes = new TextEncoder().encode(string);
                const len = Math.min(bytes.length, length, buf.length - offset);
                for (let i = 0; i < len; i++) buf[offset + i] = bytes[i];
                return len;
            },
            latin1WriteStatic: (buf, offset, length, string) => {
                const len = Math.min(string.length, length, buf.length - offset);
                for (let i = 0; i < len; i++) buf[offset + i] = string.charCodeAt(i) & 0xff;
                return len;
            },
            asciiWriteStatic: (buf, offset, length, string) => {
                const len = Math.min(string.length, length, buf.length - offset);
                for (let i = 0; i < len; i++) buf[offset + i] = string.charCodeAt(i) & 0x7f;
                return len;
            },
            hexWrite: (buf, string, offset, length) => {
                const cleanStr = string.replace(/[^A-Fa-f0-9]/g, '');
                let len = Math.min(Math.floor(cleanStr.length / 2), length, buf.length - offset);
                for (let i = 0; i < len; i++) {
                    buf[offset + i] = parseInt(cleanStr.substring(i * 2, i * 2 + 2), 16);
                }
                return len;
            },
            base64Write: (buf, string, offset, length) => {
                let b64 = string.replace(/=/g, '').replace(/[^A-Za-z0-9+/]/g, '');
                const len = b64.length;
                let p = 0;
                let written = 0;
                for (let i = 0; i < len && written < length && (offset + written) < buf.length; i += 4) {
                    const c1 = b64Lookup[b64.charCodeAt(i)];
                    const c2 = b64Lookup[b64.charCodeAt(i + 1)];
                    const c3 = i + 2 < len ? b64Lookup[b64.charCodeAt(i + 2)] : 0;
                    const c4 = i + 3 < len ? b64Lookup[b64.charCodeAt(i + 3)] : 0;

                    buf[offset + written++] = (c1 << 2) | (c2 >> 4);
                    if (i + 2 < len && written < length && (offset + written) < buf.length) {
                        buf[offset + written++] = ((c2 & 15) << 4) | (c3 >> 2);
                    }
                    if (i + 3 < len && written < length && (offset + written) < buf.length) {
                        buf[offset + written++] = ((c3 & 3) << 6) | c4;
                    }
                }
                return written;
            },
            base64urlWrite: (buf, string, offset, length) => {
                let b64 = string.replace(/-/g, '+').replace(/_/g, '/');
                while (b64.length % 4) b64 += '=';
                return globalThis.internalBinding('buffer').base64Write(buf, b64, offset, length);
            },
            ucs2Write: (buf, string, offset, length) => {
                let written = 0;
                const len = Math.min(string.length, Math.floor(length / 2), Math.floor((buf.length - offset) / 2));
                for (let i = 0; i < len; i++) {
                    const code = string.charCodeAt(i);
                    buf[offset + written++] = code & 0xff;
                    buf[offset + written++] = (code >> 8) & 0xff;
                }
                return written;
            }
        };
    }
    if (name === 'util') return {
        constructSharedArrayBuffer: (size) => new (typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : ArrayBuffer)(size),
        guessHandleType: (fd) => 'FILE',
        sleep: (ms) => {
            const start = Date.now();
            while (Date.now() - start < ms) {}
        },
        defineLazyProperties: (target, moduleName, keys) => {
            for (const key of keys) {
                Object.defineProperty(target, key, {
                    configurable: true,
                    enumerable: true,
                    get() {
                        const mod = require(moduleName);
                        const val = mod[key];
                        Object.defineProperty(target, key, {
                            value: val,
                            writable: true,
                            configurable: true,
                            enumerable: true
                        });
                        return val;
                    }
                });
            }
        },
        privateSymbols: {
            arrow_message_private_symbol: Symbol('arrow_message_private_symbol'),
            decorated_private_symbol: Symbol('decorated_private_symbol'),
            untransferable_object_private_symbol: Symbol('untransferable_object_private_symbol'),
            transfer_mode_private_symbol: Symbol('transfer_mode_private_symbol')
        },
        constants: {
            kDisallowCloneAndTransfer: 0,
            kTransferable: 1,
            kCloneable: 2
        }
    };
    if (name === 'symbols') return {
        messaging_deserialize_symbol: Symbol('messaging_deserialize_symbol'),
        messaging_transfer_symbol: Symbol('messaging_transfer_symbol'),
        messaging_clone_symbol: Symbol('messaging_clone_symbol'),
        messaging_transfer_list_symbol: Symbol('messaging_transfer_list_symbol'),
        resource_symbol: Symbol('resource_symbol'),
        owner_symbol: Symbol('owner_symbol'),
        async_id_symbol: Symbol('async_id_symbol'),
        trigger_async_id_symbol: Symbol('trigger_async_id_symbol')
    };
    if (name === 'messaging') return {
        setDeserializerCreateObjectFunction: () => {},
        structuredClone: (x) => structuredClone(x)
    };
    if (name === 'crypto') return {
        hash: (a, d) => globalThis.__rust_crypto.hash(a, d),
        randomBytes: (s) => globalThis.__rust_crypto.randomBytes(s)
    };
    if (name === 'types') return {
        isDate: (o) => o instanceof Date,
        isRegExp: (o) => o instanceof RegExp,
        isPromise: (o) => o instanceof Promise,
        isMap: (o) => o instanceof Map,
        isSet: (o) => o instanceof Set,
        isWeakMap: (o) => o instanceof WeakMap,
        isWeakSet: (o) => o instanceof WeakSet,
        isArrayBuffer: (o) => o instanceof ArrayBuffer,
        isDataView: (o) => o instanceof DataView,
        isExternal: (o) => false,
        isMapIterator: (o) => false,
        isSetIterator: (o) => false,
        isAsyncFunction: (o) => typeof o === 'function' && o.constructor.name === 'AsyncFunction',
        isGeneratorFunction: (o) => typeof o === 'function' && o.constructor.name === 'GeneratorFunction',
        isGeneratorObject: (o) => false,
        isTypedArray: (o) => ArrayBuffer.isView(o) && !(o instanceof DataView),
        isUint8Array: (o) => o instanceof Uint8Array || (o && o.constructor && o.constructor.name === 'Buffer'),
        isUint8ClampedArray: (o) => o instanceof Uint8ClampedArray,
        isUint16Array: (o) => o instanceof Uint16Array,
        isUint32Array: (o) => o instanceof Uint32Array,
        isInt8Array: (o) => o instanceof Int8Array,
        isInt16Array: (o) => o instanceof Int16Array,
        isInt32Array: (o) => o instanceof Int32Array,
        isFloat32Array: (o) => o instanceof Float32Array,
        isFloat64Array: (o) => o instanceof Float64Array,
        isBigInt64Array: (o) => typeof BigInt64Array !== 'undefined' && o instanceof BigInt64Array,
        isBigUint64Array: (o) => typeof BigUint64Array !== 'undefined' && o instanceof BigUint64Array,
        isNativeError: (o) => o instanceof Error
    };
    return {};
};

globalThis.getInternalBinding = globalThis.internalBinding;
globalThis.getLinkedBinding = globalThis.internalBinding;

globalThis.setTimeout = (fn, ms) => {
    if (typeof ms !== 'number' || ms < 10) {
        Promise.resolve().then(fn);
        return;
    }
    globalThis.__pending_timers = globalThis.__pending_timers || new Map();
    const id = Math.random().toString(36);
    globalThis.__pending_timers.set(id, fn);
    sendToElixir({ type: 'timer_start', delay: ms, id: id });
};

globalThis.__resolve_timer = (id) => {
    if (globalThis.__pending_timers && globalThis.__pending_timers.has(id)) {
        const fn = globalThis.__pending_timers.get(id);
        fn();
        globalThis.__pending_timers.delete(id);
    }
};

globalThis.sendToElixir = (data) => globalThis.__elixir_send.send(JSON.stringify(data));
globalThis.process = {
    platform: 'win32',
    version: 'v26.0.0',
    versions: {
        node: '26.0.0',
        uv: '1.46.0',
        zlib: '1.2.13',
        brotli: '1.0.9',
        ares: '1.20.1',
        modules: '120',
        nghttp2: '1.57.0',
        napi: '9',
        llhttp: '8.1.1',
        openssl: '3.0.12',
        cldr: '43.0',
        icu: '73.2',
        tz: '2023c',
        unicode: '15.0',
        amaro: '0.1.0'
    },
    nextTick: (f) => Promise.resolve().then(f),
    env: {}
};
globalThis.global = globalThis;
"Bootstrap Loaded";
