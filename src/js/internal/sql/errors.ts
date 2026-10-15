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

// oxlint-disable-next-line typescript-eslint/no-unsafe-declaration-merging
interface PostgresError {
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

  constructor(message: string, options: PostgresErrorOptions) {
    super(message);

    this.name = "PostgresError";
    const {
      code,
      errno,
      detail,
      hint,
      severity,
      position,
      internalPosition,
      internalQuery,
      where,
      schema,
      table,
      column,
      dataType,
      constraint,
      file,
      line,
      routine,
    } = options;
    this.code = code;

    if (errno !== undefined) this.errno = errno;
    if (detail !== undefined) this.detail = detail;
    if (hint !== undefined) this.hint = hint;
    if (severity !== undefined) this.severity = severity;
    if (position !== undefined) this.position = position;
    if (internalPosition !== undefined) this.internalPosition = internalPosition;
    if (internalQuery !== undefined) this.internalQuery = internalQuery;
    if (where !== undefined) this.where = where;
    if (schema !== undefined) this.schema = schema;
    if (table !== undefined) this.table = table;
    if (column !== undefined) this.column = column;
    if (dataType !== undefined) this.dataType = dataType;
    if (constraint !== undefined) this.constraint = constraint;
    if (file !== undefined) this.file = file;
    if (line !== undefined) this.line = line;
    if (routine !== undefined) this.routine = routine;
  }
}

export interface SQLiteErrorOptions {
  code: string;
  errno: number;
  byteOffset?: number | undefined;
}

// oxlint-disable-next-line typescript-eslint/no-unsafe-declaration-merging
interface SQLiteError {
  byteOffset?: number | undefined;
}

class SQLiteError extends SQLError implements Bun.SQL.SQLiteError {
  public readonly code: string;
  public readonly errno: number;

  constructor(message: string, options: SQLiteErrorOptions) {
    super(message);

    this.name = "SQLiteError";

    const { code, errno, byteOffset } = options;
    this.code = code;
    this.errno = errno;

    if (byteOffset !== undefined) this.byteOffset = byteOffset;
  }
}

export interface MySQLErrorOptions {
  code: string;
  errno?: number | undefined;
  sqlState?: string | undefined;
}

// oxlint-disable-next-line typescript-eslint/no-unsafe-declaration-merging
interface MySQLError {
  errno?: number | undefined;
  sqlState?: string | undefined;
}

class MySQLError extends SQLError implements Bun.SQL.MySQLError {
  public readonly code: string;

  constructor(message: string, options: MySQLErrorOptions) {
    super(message);

    this.name = "MySQLError";
    const { code, errno, sqlState } = options;
    this.code = code;

    if (errno !== undefined) this.errno = errno;
    if (sqlState !== undefined) this.sqlState = sqlState;
  }
}

export default { PostgresError, SQLError, SQLiteError, MySQLError };
