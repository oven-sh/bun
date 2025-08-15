class SQLError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SQLError";
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      stack: this.stack,
    };
  }
}

class PostgresError extends SQLError {
  public readonly code: string;
  public readonly errno: string;
  public readonly detail: string;
  public readonly hint: string;
  public readonly severity: string;

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
      detail: string;
      hint: string;
      severity: string;
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
    this.detail = options.detail;
    this.hint = options.hint;
    this.severity = options.severity;

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

  toJSON() {
    const json: any = {
      name: this.name,
      message: this.message,
      code: this.code,
      detail: this.detail,
      hint: this.hint,
      severity: this.severity,
      stack: this.stack,
    };

    if (this.position !== undefined) json.position = this.position;
    if (this.internalPosition !== undefined) json.internalPosition = this.internalPosition;
    if (this.internalQuery !== undefined) json.internalQuery = this.internalQuery;
    if (this.where !== undefined) json.where = this.where;
    if (this.schema !== undefined) json.schema = this.schema;
    if (this.table !== undefined) json.table = this.table;
    if (this.column !== undefined) json.column = this.column;
    if (this.dataType !== undefined) json.dataType = this.dataType;
    if (this.constraint !== undefined) json.constraint = this.constraint;
    if (this.file !== undefined) json.file = this.file;
    if (this.line !== undefined) json.line = this.line;
    if (this.routine !== undefined) json.routine = this.routine;

    return json;
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

  toJSON() {
    const json: any = {
      name: this.name,
      message: this.message,
      code: this.code,
      errno: this.errno,
      stack: this.stack,
    };
    if (this.byteOffset !== undefined) {
      json.byteOffset = this.byteOffset;
    }
    return json;
  }
}

export { PostgresError, SQLError, SQLiteError };
