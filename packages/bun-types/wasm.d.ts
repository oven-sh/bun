declare module "bun" {
  namespace WebAssembly {
    type ImportExportKind = "function" | "global" | "memory" | "table" | "tag";
    type TableKind = "anyfunc" | "externref";
    type ExportValue = Function | Global | WebAssembly.Memory | WebAssembly.Table | Tag;
    type Exports = Record<string, ExportValue>;
    type ImportValue = ExportValue | number;
    type Imports = Record<string, ModuleImports>;
    type ModuleImports = Record<string, ImportValue>;

    interface ValueTypeMap {
      anyfunc: Function;
      externref: any;
      f32: number;
      f64: number;
      i32: number;
      i64: bigint;
      v128: never;
    }

    type ValueType = keyof ValueTypeMap;

    interface GlobalDescriptor<T extends ValueType = ValueType> {
      mutable?: boolean;
      value: T;
    }

    interface Global<T extends ValueType = ValueType> {
      // <T extends ValueType = ValueType> {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Global/value) */
      value: ValueTypeMap[T];
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Global/valueOf) */
      valueOf(): ValueTypeMap[T];
    }

    interface CompileError extends Error {}

    interface LinkError extends Error {}

    interface RuntimeError extends Error {}

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Instance) */
    interface Instance {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Instance/exports) */
      readonly exports: Exports;
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Memory) */
    interface Memory {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Memory/buffer) */
      readonly buffer: ArrayBuffer;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Memory/grow) */
      grow(delta: number): number;
      /**
       * Returns the memory as a fixed-length buffer, which becomes
       * {@link buffer}. A resizable buffer of the memory is detached.
       *
       * For a shared memory the result is a `SharedArrayBuffer`, and no buffer
       * is detached.
       */
      toFixedLengthBuffer(): ArrayBuffer | SharedArrayBuffer;
      /**
       * Returns the memory as a resizable buffer, which becomes {@link buffer}.
       * The fixed-length buffer of the memory is detached. The resizable buffer
       * grows with the memory, and its `maxByteLength` is the maximum size of
       * the memory.
       *
       * For a shared memory the result is a growable `SharedArrayBuffer`, and
       * no buffer is detached.
       */
      toResizableBuffer(): ArrayBuffer | SharedArrayBuffer;
    }

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Module) */
    interface Module {}

    /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Table) */
    interface Table {
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Table/length) */
      readonly length: number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Table/get) */
      get(index: number): any;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Table/grow) */
      grow(delta: number, value?: any): number;
      /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Table/set) */
      set(index: number, value?: any): void;
    }

    interface MemoryDescriptor {
      initial: number;
      maximum?: number;
      shared?: boolean;
    }

    interface ModuleExportDescriptor {
      kind: ImportExportKind;
      name: string;
    }

    interface ModuleImportDescriptor {
      kind: ImportExportKind;
      module: string;
      name: string;
    }

    interface TableDescriptor {
      element: TableKind;
      initial: number;
      maximum?: number;
    }

    interface WebAssemblyInstantiatedSource {
      instance: Instance;
      module: Module;
    }

    interface TagType {
      /** The value types of the values that an exception with this tag carries. */
      parameters: ValueType[];
    }

    interface ExceptionOptions {
      /** Give the exception a `stack` property with a stack trace. Defaults to `false`. */
      traceStack?: boolean;
    }

    /**
     * The type of a WebAssembly exception: the value types of the values that
     * the exception carries.
     *
     * [MDN Reference](https://developer.mozilla.org/docs/WebAssembly/Reference/JavaScript_interface/Tag)
     */
    interface Tag {
      readonly [Symbol.toStringTag]: "WebAssembly.Tag";
    }

    /**
     * An exception that WebAssembly code throws to JavaScript, or that
     * JavaScript throws to WebAssembly code. It is not an instance of `Error`.
     *
     * [MDN Reference](https://developer.mozilla.org/docs/WebAssembly/Reference/JavaScript_interface/Exception)
     */
    interface Exception {
      /**
       * A stack trace, if the exception was created with `traceStack: true`.
       * Otherwise `undefined`.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/WebAssembly/Reference/JavaScript_interface/Exception/stack)
       */
      readonly stack: string | undefined;
      /**
       * Returns the value at `index` among the values that the exception carries.
       *
       * Throws a `TypeError` if `exceptionTag` is not the tag of the exception,
       * and a `RangeError` if `index` is out of range.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/WebAssembly/Reference/JavaScript_interface/Exception/getArg)
       */
      getArg(exceptionTag: Tag, index: number): any;
      /**
       * Returns `true` if `exceptionTag` is the tag of the exception.
       *
       * [MDN Reference](https://developer.mozilla.org/docs/WebAssembly/Reference/JavaScript_interface/Exception/is)
       */
      is(exceptionTag: Tag): boolean;
    }
  }
}

declare namespace WebAssembly {
  interface ValueTypeMap extends Bun.WebAssembly.ValueTypeMap {}
  interface GlobalDescriptor<T extends keyof ValueTypeMap = keyof ValueTypeMap> extends Bun.WebAssembly
    .GlobalDescriptor<T> {}
  interface MemoryDescriptor extends Bun.WebAssembly.MemoryDescriptor {}
  interface ModuleExportDescriptor extends Bun.WebAssembly.ModuleExportDescriptor {}
  interface ModuleImportDescriptor extends Bun.WebAssembly.ModuleImportDescriptor {}
  interface TableDescriptor extends Bun.WebAssembly.TableDescriptor {}
  interface WebAssemblyInstantiatedSource extends Bun.WebAssembly.WebAssemblyInstantiatedSource {}

  interface LinkError extends Bun.WebAssembly.LinkError {}
  var LinkError: {
    prototype: LinkError;
    new (message?: string): LinkError;
    (message?: string): LinkError;
  };

  interface CompileError extends Bun.WebAssembly.CompileError {}
  var CompileError: {
    prototype: CompileError;
    new (message?: string): CompileError;
    (message?: string): CompileError;
  };

  interface RuntimeError extends Bun.WebAssembly.RuntimeError {}
  var RuntimeError: {
    prototype: RuntimeError;
    new (message?: string): RuntimeError;
    (message?: string): RuntimeError;
  };

  interface Global<T extends keyof ValueTypeMap = keyof ValueTypeMap> extends Bun.WebAssembly.Global<T> {}
  var Global: {
    prototype: Global;
    new <T extends Bun.WebAssembly.ValueType = Bun.WebAssembly.ValueType>(
      descriptor: GlobalDescriptor<T>,
      v?: ValueTypeMap[T],
    ): Global<T>;
  };

  interface Instance extends Bun.WebAssembly.Instance {}
  var Instance: Bun.__internal.UseLibDomIfAvailable<
    "WebAssembly",
    {
      Instance: {
        prototype: Instance;
        new (module: Module, importObject?: Bun.WebAssembly.Imports): Instance;
      };
    }
  >["Instance"];

  interface Memory extends Bun.WebAssembly.Memory {}
  var Memory: {
    prototype: Memory;
    new (descriptor: MemoryDescriptor): Memory;
  };

  interface Module extends Bun.WebAssembly.Module {}
  var Module: Bun.__internal.UseLibDomIfAvailable<
    "WebAssembly",
    {
      Module: {
        prototype: Module;
        new (bytes: Bun.BufferSource): Module;
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Module/customSections) */
        customSections(moduleObject: Module, sectionName: string): ArrayBuffer[];
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Module/exports) */
        exports(moduleObject: Module): ModuleExportDescriptor[];
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Module/imports) */
        imports(moduleObject: Module): ModuleImportDescriptor[];
      };
    }
  >["Module"];

  interface TagType extends Bun.WebAssembly.TagType {}
  interface ExceptionOptions extends Bun.WebAssembly.ExceptionOptions {}

  interface Tag extends Bun.WebAssembly.Tag {}
  var Tag: {
    prototype: Tag;
    new (type: TagType): Tag;
  };

  interface Exception extends Bun.WebAssembly.Exception {}
  var Exception: {
    prototype: Exception;
    /**
     * @param exceptionTag The tag of the exception. `WebAssembly.JSTag` is not accepted.
     * @param payload One value for each of the `parameters` of the tag
     */
    new (exceptionTag: Tag, payload: any[], options?: ExceptionOptions): Exception;
  };

  /**
   * The tag of a value that JavaScript throws. WebAssembly code that imports
   * this tag can catch such a value as an `externref`.
   */
  var JSTag: Tag;

  // `promising`, `Suspending` and `SuspendError` are not declared here. lib.dom does not declare them
  // yet. If it later gives `Suspending` or `SuspendError` another type than a `var` here has, that
  // is an error (TS2403).

  interface Table extends Bun.WebAssembly.Table {}
  var Table: {
    prototype: Table;
    new (descriptor: TableDescriptor, value?: any): Table;
  };

  /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/compile) */
  function compile(bytes: Bun.BufferSource): Promise<Module>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/compileStreaming) */
  function compileStreaming(source: Response | PromiseLike<Response>): Promise<Module>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/instantiate) */
  function instantiate(
    bytes: Bun.BufferSource,
    importObject?: Bun.WebAssembly.Imports,
  ): Promise<WebAssemblyInstantiatedSource>;
  function instantiate(moduleObject: Module, importObject?: Bun.WebAssembly.Imports): Promise<Instance>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/instantiateStreaming) */
  function instantiateStreaming(
    source: Response | PromiseLike<Response>,
    importObject?: Bun.WebAssembly.Imports,
  ): Promise<WebAssemblyInstantiatedSource>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/validate) */
  function validate(bytes: Bun.BufferSource): boolean;
}
