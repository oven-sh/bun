class SQLError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SQLError";
  }
}

class PostgresError extends SQLError {
  public readonly code: string;
  public readonly detail?: string;
  public readonly hint?: string;
  public readonly severity?: string;
  public readonly errno?: string;
  public readonly position?: string;
  public readonly internalPosition?: string;
  public readonly internalQuery?: string;
  public readonly where?: string;
  public readonly schema?: string;
  public readonly table?: string;
  public readonly column?: string;
  public readonly dataType?: string;
  public readonly constraint?: string;
  public readonly file?: string;
  public readonly line?: string;
  public readonly routine?: string;

  constructor(
    message: string,
    options: {
      code: string;
      detail?: string;
      hint?: string;
      severity?: string;
      errno?: string;
      position?: string;
      internalPosition?: string;
      internalQuery?: string;
      where?: string;
      schema?: string;
      table?: string;
      column?: string;
      dataType?: string;
      constraint?: string;
      file?: string;
      line?: string;
      routine?: string;
    },
  ) {
    super(message);
    this.name = "PostgresError";

    this.code = options.code;
    if (options.detail !== undefined) this.detail = options.detail;
    if (options.hint !== undefined) this.hint = options.hint;
    if (options.severity !== undefined) this.severity = options.severity;
    if (options.errno !== undefined) this.errno = options.errno;
    if (options.position !== undefined) this.position = options.position;
    if (options.internalPosition !== undefined) this.internalPosition = options.internalPosition;
    if (options.internalQuery !== undefined) this.internalQuery = options.internalQuery;
    if (options.where !== undefined) this.where = options.where;
    if (options.schema !== undefined) this.schema = options.schema;
    if (options.table !== undefined) this.table = options.table;
    if (options.column !== undefined) this.column = options.column;
    if (options.dataType !== undefined) this.dataType = options.dataType;
    if (options.constraint !== undefined) this.constraint = options.constraint;
    if (options.file !== undefined) this.file = options.file;
    if (options.line !== undefined) this.line = options.line;
    if (options.routine !== undefined) this.routine = options.routine;
  }
}

class SQLiteError extends SQLError {
  public readonly code: string;
  public readonly errno: number;
  public readonly byteOffset?: number;

  constructor(message: string, options: { code: string; errno: number; byteOffset?: number }) {
    super(message);
    this.name = "SQLiteError";

    this.code = options.code;
    this.errno = options.errno;
    if (options.byteOffset !== undefined) {
      this.byteOffset = options.byteOffset;
    }
  }
}

export default { PostgresError, SQLError, SQLiteError };
