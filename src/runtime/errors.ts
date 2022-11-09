// @ts-nocheck
var __BuildError;
var __ResolveError;
var __ImportKind;
{
  enum ImportKind {
    entry_point = 0,
    stmt = 1,
    require = 2,
    dynamic = 3,
    require_resolve = 4,
    at = 5,
    at_conditional = 6,
    url = 7,
  }

  type ErrorPosition = {
    file: string;
    namespace: string;
    line: number; // 1-based
    column: number; // 0-based, byte offset relative to lineText
    length: number; // in bytes
    /** line of text, possibly empty */
    lineText: string;
    /** byte offset relative to the start of the file */
    offset: number;
  };

  interface BuildErrorImplementation {
    position: ErrorPosition;
    name: string;
    message: string;
  }

  interface ResolveErrorImplementation extends BuildErrorImplementation {
    specifier: string;
    importKind: ImportKind;
  }

  class BuildError extends Error {
    constructor(data: BuildErrorImplementation) {
      super(data.message);
      this.name = data.name;
      this.data = data;
    }
    data: BuildErrorImplementation;

    get position() {
      return this.data.position;
    }

    get [Symbol.toStringTag]() {
      return `${this.name}: ${this.message}`;
    }
  }

  class ResolveError extends BuildError {
    constructor(data: ResolveErrorImplementation) {
      super(data);
      this.name = data.name;
      this.data = data;
    }
    data: ResolveErrorImplementation;

    get importKind() {
      return this.data.importKind;
    }

    get specifier() {
      return this.data.specifier || "";
    }
  }

  __ResolveError = ResolveError;
  __BuildError = BuildError;
  __ImportKind = ImportKind;
}

export {
  __ResolveError as ResolveError,
  __BuildError as BuildError,
  __ImportKind as ImportKind,
};
