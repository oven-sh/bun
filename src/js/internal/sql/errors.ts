class SQLError extends Error implements Bun.SQL.SQLError {
  constructor(message: string) {
    super(message);
    this.name = "SQLError";
  }
}

export interface PostgresErrorOptions {
  code: string;

  detail?: string | undefined;
  hint?: string | undefined;
  severity?: string | undefined;
  errno?: string | undefined;
  position?: string | undefined;
  internalPosition?: string | undefined;
  internalQuery?: string | undefined;
  where?: string | undefined;
  schema?: string | undefined;
  table?: string | undefined;
  column?: string | undefined;
  dataType?: string | undefined;
  constraint?: string | undefined;
  file?: string | undefined;
  line?: string | undefined;
  routine?: string | undefined;
}

class PostgresError extends SQLError implements Bun.SQL.PostgresError {
  public readonly code: string;
  public readonly detail: string | undefined;
  public readonly hint: string | undefined;
  public readonly severity: string | undefined;
  public readonly errno: string | undefined;
  public readonly position: string | undefined;
  public readonly internalPosition: string | undefined;
  public readonly internalQuery: string | undefined;
  public readonly where: string | undefined;
  public readonly schema: string | undefined;
  public readonly table: string | undefined;
  public readonly column: string | undefined;
  public readonly dataType: string | undefined;
  public readonly constraint: string | undefined;
  public readonly file: string | undefined;
  public readonly line: string | undefined;
  public readonly routine: string | undefined;

  constructor(message: string, options: PostgresErrorOptions) {
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

export interface SQLiteErrorOptions {
  code: string;
  errno: number;
  byteOffset?: number | undefined;
}

class SQLiteError extends SQLError implements Bun.SQL.SQLiteError {
  public readonly code: string;
  public readonly errno: number;
  public readonly byteOffset: number | undefined;

  constructor(message: string, options: SQLiteErrorOptions) {
    super(message);

    this.name = "SQLiteError";
    this.code = options.code;
    this.errno = options.errno;

    if (options.byteOffset !== undefined) this.byteOffset = options.byteOffset;
  }
}

export interface MySQLErrorOptions {
  code: string;
  errno: number | undefined;
  sqlState: string | undefined;
}

class MySQLError extends SQLError implements Bun.SQL.MySQLError {
  public readonly code: string;
  public readonly errno: number | undefined;
  public readonly sqlState: string | undefined;

  constructor(message: string, options: MySQLErrorOptions) {
    super(message);

    this.name = "MySQLError";
    this.code = options.code;
    this.errno = options.errno;
    this.sqlState = options.sqlState;
  }
}
export default { PostgresError, SQLError, SQLiteError, MySQLError };
