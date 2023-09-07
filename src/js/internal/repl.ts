import { type JSC } from '../../../packages/bun-inspector-protocol';
const { join } = require('node:path') as typeof import('node:path');
const os = require('node:os') as typeof import('node:os');
const util = require('node:util') as typeof import('node:util');
const readline = require('node:readline/promises') as typeof import('node:readline/promises');
const { serve } = Bun;
const { exit } = process;

const { Buffer, WebSocket, Map, EvalError } = globalThis;
const Promise: PromiseConstructor<any> = globalThis.Promise; // TS bug?
const { isBuffer } = Buffer;
const JSONParse = JSON.parse;
const JSONStringify = JSON.stringify;
const ObjectAssign = Object.assign;
const BufferToString = Function.prototype.call.bind(Buffer.prototype.toString) as Primordial<Buffer, 'toString'>;
const StringTrim = Function.prototype.call.bind(String.prototype.trim) as Primordial<String, 'trim'>;
const StringPrototypeSplit = Function.prototype.call.bind(String.prototype.split) as Primordial<String, 'split'>;
const StringPrototypeIncludes = Function.prototype.call.bind(String.prototype.includes) as Primordial<String, 'includes'>;
const StringPrototypeReplaceAll = Function.prototype.call.bind(String.prototype.replaceAll) as Primordial<String, 'replaceAll'>;
const ArrayPrototypePop = Function.prototype.call.bind(Array.prototype.pop) as Primordial<Array<any>, 'pop'>;
const ArrayPrototypeJoin = Function.prototype.call.bind(Array.prototype.join) as Primordial<Array<any>, 'join'>;
const MapGet = Function.prototype.call.bind(Map.prototype.get) as Primordial<Map<any, any>, 'get'>;
const MapSet = Function.prototype.call.bind(Map.prototype.set) as Primordial<Map<any, any>, 'set'>;
const MapDelete = Function.prototype.call.bind(Map.prototype.delete) as Primordial<Map<any, any>, 'delete'>;
const console = {
    log: globalThis.console.log,
    info: globalThis.console.info,
    warn: globalThis.console.warn,
    error: globalThis.console.error,
};

type Primordial<T, M extends keyof T> = <S extends T>(
    self: S, ...args: Parameters<S[M] extends (...args: any) => any ? S[M] : never>
) => ReturnType<S[M] extends (...args: any) => any ? S[M] : never>;
type JSCResponsePromiseCallbacks = {
    resolve: <T extends JSC.ResponseMap[keyof JSC.ResponseMap]>(value: T) => void;
    reject: (reason: {
        code?: string | undefined;
        message: string;
    }) => void;
};
type EvalRemoteObject = JSC.Runtime.RemoteObject & { wasAwaited?: boolean; wasThrown?: boolean; };
type RemoteObjectType = EvalRemoteObject['type'];
type RemoteObjectSubtype = NonNullable<EvalRemoteObject['subtype']>;
type TypeofToValueType<T extends RemoteObjectType> =
    T extends 'string' ? { type: T, value: string; } :
    T extends 'number' ? { type: T, value: number, description: string; } :
    T extends 'bigint' ? { type: T, description: string; } :
    T extends 'boolean' ? { type: T, value: boolean; } :
    T extends 'symbol' ? { type: T, objectId: string, className: string, description: string; } :
    T extends 'undefined' ? { type: T; } :
    T extends 'object' ? { type: T, subtype?: RemoteObjectSubtype, objectId: string, className: string, description: string; } :
    T extends 'function' ? { type: T, subtype?: RemoteObjectSubtype, objectId: string, className: string, description: string; } : never;
type SubtypeofToValueType<T extends RemoteObjectSubtype, BaseObj = { type: 'object', subtype: T, objectId: string, className: string, description: string; }> =
    T extends 'error' ? BaseObj :
    T extends 'array' ? BaseObj & { size: number; } :
    T extends 'null' ? { type: 'object', subtype: T, value: null; } :
    T extends 'regexp' ? BaseObj :
    T extends 'date' ? BaseObj :
    T extends 'map' ? BaseObj & { size: number; } :
    T extends 'set' ? BaseObj & { size: number; } :
    T extends 'weakmap' ? BaseObj & { size: number; } :
    T extends 'weakset' ? BaseObj & { size: number; } :
    T extends 'iterator' ? never /*//!error*/ :
    T extends 'class' ? { type: 'function', subtype: T, objectId: string, className: string, description: string, classPrototype: JSC.Runtime.RemoteObject; } :
    T extends 'proxy' ? BaseObj :
    T extends 'weakref' ? BaseObj : never;

/** Convert a {@link WebSocket.onmessage} `event.data` value to a string. */
function wsDataToString(data: Parameters<NonNullable<WebSocket['onmessage']>>[0]['data']): string {
    //if (data instanceof ArrayBuffer) return new TextDecoder('utf-8').decode(data);
    if (data instanceof Buffer || isBuffer(data)) return BufferToString(data, 'utf-8');
    else return data;
}

// Note: This is a custom REPLServer, not the Node.js node:repl module one.
class REPLServer extends WebSocket {
    constructor() {
        const server = serve({
            inspector: true,
            development: true,
            // @ts-expect-error stub
            fetch() { },
        });
        super(`ws://${server.hostname}:${server.port}/bun:inspect`);
        this.onmessage = (event) => {
            try {
                const data = JSONParse(wsDataToString(event.data)) as JSC.Response<keyof JSC.ResponseMap>;
                const { id } = data;
                const promiseRef = MapGet(this.#pendingReqs, id);
                if (promiseRef) {
                    MapDelete(this.#pendingReqs, id);
                    if ('error' in data) promiseRef.reject(data.error);
                    else if ('result' in data) promiseRef.resolve(data.result);
                    else throw `Received response with no result or error: ${id}`;
                } else throw `Received message for unknown request ID: ${id}`;
            } catch (err) {
                console.error(`[ws/message] An unexpected error occured:`, err, '\nReceived Data:', event.data);
            }
        };
        this.onclose = () => console.info('[ws/close] disconnected');
        this.onerror = (error) => console.error('[ws/error]', error);
    }

    /** Incrementing current request ID */
    #reqID = 0;
    /** Object ID of the global object */
    #globalObjectID!: string;
    /** Queue of pending requests promises to resolve, mapped by request ID */
    readonly #pendingReqs = new Map<number, JSCResponsePromiseCallbacks>();
    /** Must be awaited before using the REPLServer */
    readonly ready = new Promise<void>(resolve => {
        // It's okay to not use primordials here since this only runs once before users can use the REPL
        this.onopen = () => void this.request('Runtime.enable', {})
            .then(() => this.rawEval('globalThis'))
            .then(({ result }) => {
                this.#globalObjectID = result.objectId!;
                globalThis._ = undefined;
                globalThis._error = undefined;
                Object.defineProperty(globalThis, '#Symbol.for', { value: Symbol.for });
                Object.defineProperty(globalThis, Symbol.for('#bun.repl.internal'), {
                    value: Object.freeze(Object.defineProperties(Object.create(null), {
                        util: { value: Object.freeze(util) },
                    })),
                });
                Object.freeze(globalThis['#bun.repl.internal']);
                Object.freeze(Promise); // must preserve .name property
                Object.freeze(Promise.prototype); // too many possible pitfalls
                //? Workarounds for bug: https://canary.discord.com/channels/876711213126520882/888839314056839309/1120394929164779570
                const TypedArray = Object.getPrototypeOf(Uint8Array);
                const wrapIterator = (iterable: Record<string | symbol, any>, key: string | symbol = Symbol.iterator, name = iterable.name + ' Iterator') => {
                    const original = iterable.prototype[key];
                    iterable.prototype[key] = function (...argz: any[]) {
                        const thiz = this;
                        function* wrappedIter() { yield* original.apply(thiz, argz); }
                        return Object.defineProperty(wrappedIter(), Symbol.toStringTag, { value: name, configurable: true });
                    };
                };
                wrapIterator(Array);
                wrapIterator(Array, 'keys');
                wrapIterator(Array, 'values');
                wrapIterator(Array, 'entries');
                wrapIterator(TypedArray, Symbol.iterator, 'Array Iterator');
                wrapIterator(TypedArray, 'entries', 'Array Iterator');
                wrapIterator(TypedArray, 'values', 'Array Iterator');
                wrapIterator(TypedArray, 'keys', 'Array Iterator');
                wrapIterator(String);
                wrapIterator(Map);
                wrapIterator(Map, 'keys');
                wrapIterator(Map, 'values');
                wrapIterator(Map, 'entries');
                wrapIterator(Set);
                wrapIterator(Set, 'keys');
                wrapIterator(Set, 'values');
                wrapIterator(Set, 'entries');

                resolve();
            });
    });

    /** Check and assert typeof for a remote object */
    typeof<T extends RemoteObjectType>(v: JSC.Runtime.RemoteObject, expected: T):
        v is Omit<JSC.Runtime.RemoteObject, 'value'> & TypeofToValueType<T> {
        return v.type === expected;
    }
    /** Check and assert subtypeof for a remote object */
    subtypeof<T extends RemoteObjectSubtype>(v: JSC.Runtime.RemoteObject, expected: T):
        v is Omit<JSC.Runtime.RemoteObject, 'value'> & SubtypeofToValueType<T> {
        return v.subtype === expected;
    }
    /** Send a direct request to the inspector */
    request<T extends keyof JSC.RequestMap>(method: T, params: JSC.RequestMap[T]) {
        const req: JSC.Request<T> = { id: ++this.#reqID, method, params };
        const response = new Promise<JSC.ResponseMap[T]>((resolve, reject) => {
            MapSet(this.#pendingReqs, this.#reqID, { resolve: resolve as typeof resolve extends Promise<infer P> ? P : never, reject });
        }).catch(err => { throw ObjectAssign(new Error, err); });
        this.send(JSONStringify(req));
        return response;
    }
    /** Direct shortcut for a `Runtime.evaluate` request */
    async rawEval(code: string): Promise<JSC.Runtime.EvaluateResponse> {
        return this.request('Runtime.evaluate', {
            expression: code,
            generatePreview: true
        });
    }
    /** Run a snippet of code in the REPL */
    async eval(code: string, topLevelAwaited = false): Promise<string> {
        const { result, wasThrown } = await this.rawEval(code);
        let remoteObj: EvalRemoteObject = result;

        switch (result.type) {
            case 'object': {
                if (result.subtype === 'null') break;
                if (!result.objectId) throw new EvalError(`Received non-null object without objectId: ${JSONStringify(result)}`);
                if (result.className === 'Promise' && topLevelAwaited) {
                    if (!result.preview) throw new EvalError(`Received Promise object without preview: ${JSONStringify(result)}}`);
                    const awaited = await this.request('Runtime.awaitPromise', { promiseObjectId: result.objectId, generatePreview: false });
                    remoteObj = awaited.result;
                    remoteObj.wasAwaited = true;
                    break;
                }
                break;
            }
            default: break;
        }

        const inspected = await this.request('Runtime.callFunctionOn', {
            objectId: this.#globalObjectID,
            functionDeclaration: /* js */`(v) => {
                if (!${wasThrown}) this._ = v;
                else this._error = v;
                const { util } = this[this['#Symbol.for']('#bun.repl.internal')];
                if (${remoteObj.subtype === 'error'}) return Bun.inspect(v, { colors: true });
                return util.inspect(v, { colors: true }/*util.inspect.replDefaults*/);
            }`,
            arguments: [remoteObj],
        });
        if (inspected.wasThrown) throw new EvalError(`Failed to inspect object: ${JSONStringify(inspected)}`);
        if (!this.typeof(inspected.result, 'string')) throw new EvalError(`Received non-string inspect result: ${JSONStringify(inspected)}`);
        if (wasThrown && remoteObj.subtype !== 'error') return c.red + 'Uncaught ' + c.reset + inspected.result.value;
        return inspected.result.value;
    }
}

/** Terminal colors */
const c = {
    bold: '\x1B[1m',
    dim: '\x1B[2m',
    underline: '\x1B[4m',
    /** Not widely supported! */
    blink: '\x1B[5m',
    invert: '\x1B[7m',
    invisible: '\x1B[8m',

    reset: '\x1B[0m',
    //noBold: '\x1B[21m', (broken)
    noDim: '\x1B[22m',
    noUnderline: '\x1B[24m',
    noBlink: '\x1B[25m',
    noInvert: '\x1B[27m',
    visible: '\x1B[28m',

    black: '\x1B[30m',
    red: '\x1B[31m',
    green: '\x1B[32m',
    yellow: '\x1B[33m',
    blue: '\x1B[34m',
    purple: '\x1B[35m',
    cyan: '\x1B[36m',
    white: '\x1B[37m',
    gray: '\x1B[90m',
    redBright: '\x1B[91m',
    greenBright: '\x1B[92m',
    yellowBright: '\x1B[93m',
    blueBright: '\x1B[94m',
    purpleBright: '\x1B[95m',
    cyanBright: '\x1B[96m',
    whiteBright: '\x1B[97m',
} as const;
/** Terminal background colors */
const bg = {
    black: '\x1B[40m',
    red: '\x1B[41m',
    green: '\x1B[42m',
    yellow: '\x1B[43m',
    blue: '\x1B[44m',
    purple: '\x1B[45m',
    cyan: '\x1B[46m',
    white: '\x1B[47m',
    gray: '\x1B[100m',
    redBright: '\x1B[101m',
    greenBright: '\x1B[102m',
    yellowBright: '\x1B[103m',
    blueBright: '\x1B[104m',
    purpleBright: '\x1B[105m',
    cyanBright: '\x1B[106m',
    whiteBright: '\x1B[107m',
} as const;
if (!Bun.enableANSIColors) {
    for (const color in c) Reflect.set(c, color, '');
    for (const color in bg) Reflect.set(bg, color, '');
}

export default {
    async start() {
        try {
            const repl = new REPLServer();
            await repl.ready;
            const history = await loadHistoryData();
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                terminal: true,
                tabSize: 4,
                prompt: '> ',
                historySize: 1000,
                history: history.lines,
                // completions currently cause a panic "FilePoll.register failed: 17"
                //completer(line: string) {
                //    const completions = ['hello', 'world'];
                //    const hits = completions.filter(c => c.startsWith(line));
                //    return [hits.length ? hits : completions, line];
                //}
            });
            // TODO: How to make transpiler not dead-code-eliminate lone constants like "5"?
            const transpiler = new Bun.Transpiler({
                target: 'bun',
                loader: 'ts',
                minifyWhitespace: false,
                trimUnusedImports: false,
                treeShaking: false,
                inline: false,
                jsxOptimizationInline: false,
            });
            console.log(`Welcome to Bun v${Bun.version}\nType ".help" for more information.`);
            //* Only primordials should be used beyond this point!
            rl.on('close', () => {
                Bun.write(history.path, history.lines.filter(l => l !== '.exit').join('\n'))
                    .catch(() => console.warn(`[!] Failed to save REPL history to ${history.path}!`));
                console.log(''); // ensure newline
                exit(0);
            });
            rl.on('history', newHistory => {
                history.lines = newHistory;
            }); 
            rl.prompt();
            rl.on('line', async line => {
                line = StringTrim(line);
                if (!line) return rl.prompt();
                if (line[0] === '.') {
                    switch (line) {
                        case '.help': {
                            console.log(
                                `Commands & keybinds:\n` +
                                `    .help     Show this help message.\n` +
                                `    .info     Print extra REPL information.\n` +
                                `    .clear    Clear the screen. ${c.gray}(Ctrl+L)${c.reset}\n` +
                                `    .exit     Exit the REPL. ${c.gray}(Ctrl+C / Ctrl+D)${c.reset}`
                            );
                        } break;
                        case '.info': {
                            console.log(
                                `Bun v${Bun.version} ${c.gray}(${Bun.revision})${c.reset}\n` +
                                `    Color mode: ${Bun.enableANSIColors ? `${c.greenBright}Enabled` : 'Disabled'}${c.reset}`
                            );
                        } break;
                        case '.clear': {
                            rl.write(null, { ctrl: true, name: 'l' });
                        } break;
                        case '.exit': {
                            rl.close();
                        } break;
                        default: {
                            console.log(
                                `${c.red}Unknown REPL command "${c.whiteBright}${line}${c.red}", ` +
                                `type "${c.whiteBright}.help${c.red}" for more information.${c.reset}`
                            );
                        } break;
                    }
                } else {
                    let code: string;
                    try {
                        code = transpiler.transformSync(line);
                    } catch (err) {
                        console.error(err); return;
                    }
                    let hasTLA = false;
                    if (StringPrototypeIncludes(code, 'await')) {
                        hasTLA = true;
                        code = tryProcessTopLevelAwait(code);
                    }
                    console.log(await repl.eval(/* ts */`${code}`, hasTLA));
                }
                rl.prompt();
            });
        } catch (err) {
            console.error('Internal REPL Error:');
            console.error(err, '\nThis should not happen! Search GitHub issues https://bun.sh/issues or ask for #help in https://bun.sh/discord');
            exit(1);
        }
    }
};

async function loadHistoryData(): Promise<{ path: string, lines: string[] }> {
    let out: { path: string; lines: string[]; } | null;
    if (process.env.XDG_DATA_HOME && (out = await tryLoadHistory(process.env.XDG_DATA_HOME, 'bun'))) return out;
    else if (process.env.BUN_INSTALL && (out = await tryLoadHistory(process.env.BUN_INSTALL))) return out;
    else {
        const homedir = os.homedir();
        return await tryLoadHistory(homedir) ?? { path: join(homedir, '.bun_repl_history'), lines: [] };
    }
}
async function tryLoadHistory(...dir: string[]) {
    const path = join(...dir, '.bun_repl_history');
    try {
        const file = Bun.file(path);
        if (!await file.exists()) await Bun.write(path, '');
        return { path, lines: (await file.text()).split('\n') };
    } catch (err) {
        //console.log(path, err);
        return null;
    }
}

// This only supports the most basic var/let/const declarations
const JSVarDeclRegex = /(?<keyword>var|let|const)\s+(?<varname>(?:[$_\p{ID_Start}]|\\u[\da-fA-F]{4})(?:[$\u200C\u200D\p{ID_Continue}]|\\u[\da-fA-F]{4})*)/gu;

// Wrap the code in an async function if it contains top level await
// Make sure to return the result of the last expression
function tryProcessTopLevelAwait(src: string) {
    const lines = StringPrototypeSplit(src, '\n' as any);
    if (!StringTrim(lines[lines.length - 1])) ArrayPrototypePop(lines);
    lines[lines.length - 1] = 'return ' + lines[lines.length - 1] + ';})();';
    lines[0] = '(async()=>{' + lines[0];
    const transformed = StringPrototypeReplaceAll(ArrayPrototypeJoin(lines, '\n'), JSVarDeclRegex, (m, _1, _2, idx, str, groups) => {
        const { keyword, varname } = groups;
        lines[0] = `${keyword === 'const' ? 'let' : keyword} ${varname};${lines[0]}`; // hoist
        return varname;
    });
    //console.info('TLA transform executed:\n', src, '\n>>> to >>>\n', transformed);
    return transformed;
}
