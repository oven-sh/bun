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
interface PostgresError extends Omit<PostgresErrorOptions, "code"> {}

// in the order they become own properties
const postgresErrorFields = [
  "errno",
  "detail",
  "hint",
  "severity",
  "position",
  "internalPosition",
  "internalQuery",
  "where",
  "schema",
  "table",
  "column",
  "dataType",
  "constraint",
  "file",
  "line",
  "routine",
] as const;

class PostgresError extends SQLError implements Bun.SQL.PostgresError {
  public readonly code: string;

  constructor(message: string, options: PostgresErrorOptions) {
    super(message);

    // JSC's own source position, not PostgreSQL's fields of the same name
    delete this.line;
    delete this.column;

    this.name = "PostgresError";
    this.code = options.code;
    for (let i = 0; i < postgresErrorFields.length; i++) {
      const value = options[postgresErrorFields[i]];
      if (value !== undefined) this[postgresErrorFields[i]] = value;
    }
  }
}

export interface SQLiteErrorOptions {
  code: string;
  errno: number;
  byteOffset?: number | undefined;
}

// oxlint-disable-next-line typescript-eslint/no-unsafe-declaration-merging
interface SQLiteError extends Pick<SQLiteErrorOptions, "byteOffset"> {}

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
interface MySQLError extends Omit<MySQLErrorOptions, "code"> {}

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
