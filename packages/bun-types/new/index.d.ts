declare var onmessage: never;

declare var Bun: typeof import("bun");
declare var TextEncoder: typeof TextEncoder;
declare var TextDecoder: typeof TextDecoder;
declare var crypto: Crypto;
declare var performance: Performance;
declare var Event: {
  prototype: Event;
  new (type: string, eventInitDict?: Bun.EventInit): Event;
};
declare var EventTarget: {
  prototype: EventTarget;
  new (): EventTarget;
};
declare var File: typeof File;
declare var ShadowRealm: {
  prototype: ShadowRealm;
  new (): ShadowRealm;
};
declare var queueMicrotask: (callback: (...args: any[]) => void) => void;
declare var reportError: (error: any) => void;
declare var clearInterval: (id?: number | Timer) => void;
declare var clearTimeout: (id?: number | Timer) => void;
declare var clearImmediate: (id?: number | Timer) => void;
declare var setImmediate: (handler: Bun.TimerHandler, ...arguments: any[]) => Timer;
declare var setInterval: (handler: Bun.TimerHandler, interval?: number, ...arguments: any[]) => Timer;
declare var setTimeout: (handler: Bun.TimerHandler, timeout?: number, ...arguments: any[]) => Timer;
declare var addEventListener: typeof addEventListener;
declare var removeEventListener: typeof removeEventListener;
declare var ErrorEvent: {
  prototype: ErrorEvent;
  new (type: string, eventInitDict?: Bun.ErrorEventInit): ErrorEvent;
};
declare var CloseEvent: {
  prototype: CloseEvent;
  new (type: string, eventInitDict?: Bun.CloseEventInit): CloseEvent;
};
declare var MessageEvent: {
  prototype: MessageEvent;
  new <T>(type: string, eventInitDict?: Bun.MessageEventInit<T>): MessageEvent<T>;
};
declare var CustomEvent: {
  prototype: CustomEvent;
  new <T>(type: string, eventInitDict?: Bun.CustomEventInit<T>): CustomEvent<T>;
};
declare var Loader: {
  registry: Map<
    string,
    {
      key: string;
      state: number;
      fetch: Promise<any>;
      instantiate: Promise<any>;
      satisfy: Promise<any>;
      dependencies: Array<any>;
      module: {
        dependenciesMap: Map<any, any>;
      };
      linkError?: any;
      linkSucceeded: boolean;
      evaluated: boolean;
      then?: any;
      isAsync: boolean;
    }
  >;
  dependencyKeysIfEvaluated: (specifier: string) => string[];
  resolve: (specifier: string, referrer: string) => string;
};
declare var Blob: typeof Blob;
declare var WebSocket: typeof import("ws").WebSocket;
declare var navigator: Navigator;
declare var console: Console;
declare var require: NodeJS.Require;
declare var exports: any;
declare var module: NodeModule;
declare function structuredClone<T>(value: T, options?: Bun.StructuredSerializeOptions): T;
declare function postMessage(message: any, transfer?: Bun.Transferable[]): void;
declare function alert(message?: string): void;
declare function confirm(message?: string): boolean;
declare function prompt(message?: string, _default?: string): string | null;

declare interface Timer {
  ref(): Timer;
  unref(): Timer;
  hasRef(): boolean;
  refresh(): Timer;
  [Symbol.toPrimitive](): number;
}

declare interface ReadableStream<R = any> extends import("stream/web").ReadableStream {}
declare interface WritableStream<W = any> extends import("stream/web").WritableStream {}
declare interface Worker extends import("worker_threads").Worker {}

declare interface ShadowRealm {
  importValue(specifier: string, bindingName: string): Promise<any>;
  evaluate(sourceText: string): any;
}

declare interface Event {
  readonly bubbles: boolean;
  cancelBubble: () => void;
  readonly cancelable: boolean;
  readonly composed: boolean;
  composedPath(): [EventTarget?];
  readonly currentTarget: EventTarget | null;
  readonly defaultPrevented: boolean;
  readonly eventPhase: 0 | 2;
  readonly isTrusted: boolean;
  preventDefault(): void;
  returnValue: boolean;
  readonly srcElement: EventTarget | null;
  stopImmediatePropagation(): void;
  stopPropagation(): void;
  readonly target: EventTarget | null;
  readonly timeStamp: number;
  readonly type: string;
}

declare module "bun" {
  interface Env {
    [key: string]: string | undefined;
  }

  interface ProcessEnv extends Env {}

  export var env: Env;

  export var fetch: {
    (request: Request, init?: RequestInit): Promise<Response>;
    (url: string | URL | Request, init?: RequestInit): Promise<Response>;
    (input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response>;
    preconnect(
      url: string | URL,
      options?: {
        dns?: boolean;
        tcp?: boolean;
        http?: boolean;
        https?: boolean;
      },
    ): void;
  };
}

declare namespace Bun {
  export * from "bun";
}

declare interface EventTarget {
  addEventListener(
    type: string,
    listener: EventListener | EventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void;
  dispatchEvent(event: Event): boolean;
  removeEventListener(
    type: string,
    listener: EventListener | EventListenerObject,
    options?: Bun.EventListenerOptions | boolean,
  ): void;
}

declare interface File extends Blob {
  readonly lastModified: number;
  readonly name: string;
}

declare interface RequestInit extends import("undici-types").RequestInit {
  verbose?: boolean;
  proxy?: string;
  s3?: import("bun").S3Options;
}

declare interface ErrorEvent extends Event {
  readonly colno: number;
  readonly error: any;
  readonly filename: string;
  readonly lineno: number;
  readonly message: string;
}

declare interface CloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

declare interface MessageEvent<T = any> extends Event {
  readonly data: T;
  readonly lastEventId: string;
  readonly origin: string;
  readonly ports: readonly (typeof MessagePort)[];
  readonly source: Bun.MessageEventSource | null;
}

declare interface CustomEvent<T = any> extends Event {
  readonly detail: T;
}

declare interface EventListener {
  (evt: Event): void;
}

declare interface EventListenerObject {
  handleEvent(object: Event): void;
}

declare interface FetchEvent extends Event {
  readonly request: Request;
  readonly url: string;
  waitUntil(promise: Promise<any>): void;
  respondWith(response: Response | Promise<Response>): void;
}

declare var fetch: typeof import("bun").fetch;

declare interface EventMap {
  fetch: FetchEvent;
  message: MessageEvent;
  messageerror: MessageEvent;
}

declare interface AddEventListenerOptions extends Bun.EventListenerOptions {
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

declare interface Navigator {
  readonly userAgent: string;
  readonly platform: "MacIntel" | "Win32" | "Linux x86_64";
  readonly hardwareConcurrency: number;
}

declare interface Blob {
  json(): Promise<any>;
  formData(): Promise<FormData>;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
}

declare interface ArrayBuffer {
  readonly byteLength: number;
  resize(byteLength: number): ArrayBuffer;
  slice(begin: number, end?: number): ArrayBuffer;
  readonly [Symbol.toStringTag]: string;
}

declare interface SharedArrayBuffer {
  grow(size: number): SharedArrayBuffer;
}

declare interface ImportMeta {
  url: string;
  readonly path: string;
  readonly dir: string;
  readonly file: string;
  readonly env: NodeJS.ProcessEnv;
  resolveSync(moduleId: string, parent?: string): string;
  require: NodeJS.Require;
  readonly main: boolean;
  dirname: string;
  filename: string;
  hot?: {
    data: any;
  };
}

declare interface NodeModule {
  exports: any;
}

declare interface Headers {
  toJSON(): Record<string, string>;
}

declare namespace NodeJS {
  interface Process {
    readonly version: string;
    browser: boolean;
    isBun: true;
    revision: string;
    reallyExit(code?: number): never;
    dlopen(module: { exports: any }, filename: string, flags?: number): void;
  }

  interface ProcessVersions extends Dict<string> {
    bun: string;
  }

  interface ProcessEnv extends Env {}
}

declare namespace WebAssembly {
  interface ValueTypeMap extends Bun.WebAssembly.ValueTypeMap {}
  interface GlobalDescriptor<T extends keyof ValueTypeMap = keyof ValueTypeMap>
    extends Bun.WebAssembly.GlobalDescriptor<T> {}
  interface MemoryDescriptor extends Bun.WebAssembly.MemoryDescriptor {}
  interface ModuleExportDescriptor extends Bun.WebAssembly.ModuleExportDescriptor {}
  interface ModuleImportDescriptor extends Bun.WebAssembly.ModuleImportDescriptor {}
  interface TableDescriptor extends Bun.WebAssembly.TableDescriptor {}
  interface WebAssemblyInstantiatedSource extends Bun.WebAssembly.WebAssemblyInstantiatedSource {}

  interface LinkError extends Error {}
  var LinkError: {
    prototype: LinkError;
    new (message?: string): LinkError;
    (message?: string): LinkError;
  };

  interface CompileError extends Error {}
  var CompileError: {
    prototype: CompileError;
    new (message?: string): CompileError;
    (message?: string): CompileError;
  };

  interface RuntimeError extends Error {}
  var RuntimeError: {
    prototype: RuntimeError;
    new (message?: string): RuntimeError;
    (message?: string): RuntimeError;
  };

  interface Global<T extends keyof ValueTypeMap = keyof ValueTypeMap> {
    value: ValueTypeMap[T];
    valueOf(): ValueTypeMap[T];
  }
  var Global: {
    prototype: Global;
    new <T extends Bun.WebAssembly.ValueType = Bun.WebAssembly.ValueType>(
      descriptor: GlobalDescriptor<T>,
      v?: ValueTypeMap[T],
    ): Global<T>;
  };

  interface Instance {
    readonly exports: Bun.WebAssembly.Exports;
  }
  var Instance: {
    prototype: Instance;
    new (module: Module, importObject?: Bun.WebAssembly.Imports): Instance;
  };

  interface Memory {
    readonly buffer: ArrayBuffer;
    grow(delta: number): number;
  }
  var Memory: {
    prototype: Memory;
    new (descriptor: MemoryDescriptor): Memory;
  };

  interface Module {}
  var Module: {
    prototype: Module;
    new (bytes: Bun.BufferSource): Module;
    customSections(moduleObject: Module, sectionName: string): ArrayBuffer[];
    exports(moduleObject: Module): ModuleExportDescriptor[];
    imports(moduleObject: Module): ModuleImportDescriptor[];
  };

  interface Table {
    readonly length: number;
    get(index: number): any;
    grow(delta: number, value?: any): number;
    set(index: number, value?: any): void;
  }
  var Table: {
    prototype: Table;
    new (descriptor: TableDescriptor, value?: any): Table;
  };

  function compile(bytes: Bun.BufferSource): Promise<Module>;
  function compileStreaming(source: Response | PromiseLike<Response>): Promise<Module>;
  function instantiate(
    bytes: Bun.BufferSource,
    importObject?: Bun.WebAssembly.Imports,
  ): Promise<WebAssemblyInstantiatedSource>;
  function instantiate(moduleObject: Module, importObject?: Bun.WebAssembly.Imports): Promise<Instance>;
  function instantiateStreaming(
    source: Response | PromiseLike<Response>,
    importObject?: Bun.WebAssembly.Imports,
  ): Promise<WebAssemblyInstantiatedSource>;
  function validate(bytes: Bun.BufferSource): boolean;
}

declare interface Dict<T> {
  [key: string]: T | undefined;
}

declare interface ReadOnlyDict<T> {
  readonly [key: string]: T | undefined;
}

declare interface ErrnoException extends Error {
  errno?: number | undefined;
  code?: string | undefined;
  path?: string | undefined;
  syscall?: string | undefined;
}

declare interface DOMException extends Error {
  readonly message: string;
  readonly name: string;
  readonly INDEX_SIZE_ERR: 1;
  readonly DOMSTRING_SIZE_ERR: 2;
  readonly HIERARCHY_REQUEST_ERR: 3;
  readonly WRONG_DOCUMENT_ERR: 4;
  readonly INVALID_CHARACTER_ERR: 5;
  readonly NO_DATA_ALLOWED_ERR: 6;
  readonly NO_MODIFICATION_ALLOWED_ERR: 7;
  readonly NOT_FOUND_ERR: 8;
  readonly NOT_SUPPORTED_ERR: 9;
  readonly INUSE_ATTRIBUTE_ERR: 10;
  readonly INVALID_STATE_ERR: 11;
  readonly SYNTAX_ERR: 12;
  readonly INVALID_MODIFICATION_ERR: 13;
  readonly NAMESPACE_ERR: 14;
  readonly INVALID_ACCESS_ERR: 15;
  readonly VALIDATION_ERR: 16;
  readonly TYPE_MISMATCH_ERR: 17;
  readonly SECURITY_ERR: 18;
  readonly NETWORK_ERR: 19;
  readonly ABORT_ERR: 20;
  readonly URL_MISMATCH_ERR: 21;
  readonly QUOTA_EXCEEDED_ERR: 22;
  readonly TIMEOUT_ERR: 23;
  readonly INVALID_NODE_TYPE_ERR: 24;
  readonly DATA_CLONE_ERR: 25;
}

declare var DOMException: {
  prototype: DOMException;
  new (message?: string, name?: string): DOMException;
};

declare interface PromiseConstructor {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value?: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
  };
}

declare interface ArrayConstructor {
  fromAsync<T>(arrayLike: AsyncIterable<T> | Iterable<T> | ArrayLike<T>): Promise<Awaited<T>[]>;
  fromAsync<T, U>(
    arrayLike: AsyncIterable<T> | Iterable<T> | ArrayLike<T>,
    mapFn?: (value: T, index: number) => U,
    thisArg?: any,
  ): Promise<Awaited<U>[]>;
}

declare module "*.svg" {
  const content: `${string}.svg`;
  export = content;
}
