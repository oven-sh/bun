/**
 * Shared PostgreSQL type constants and utilities.
 *
 * This module provides a single source of truth for PostgreSQL type OIDs,
 * used by both regular SQL array serialization and COPY binary protocol.
 */

/**
 * PostgreSQL base type OIDs (type name -> OID)
 * Used for binary COPY format encoding
 */
export const BASE_TYPE_OID: Record<string, number> = {
  bool: 16,
  int2: 21,
  int4: 23,
  int8: 20,
  float4: 700,
  float8: 701,
  text: 25,
  varchar: 1043,
  bpchar: 1042,
  bytea: 17,
  date: 1082,
  time: 1083,
  timestamp: 1114,
  timestamptz: 1184,
  uuid: 2950,
  json: 114,
  jsonb: 3802,
  numeric: 1700,
  interval: 1186,
};

/**
 * PostgreSQL array type OIDs (array type token -> OID)
 * Used for binary COPY format array encoding
 */
export const ARRAY_TYPE_OID: Record<string, number> = {
  // Boolean
  "bool[]": 1000,

  // Binary
  "bytea[]": 1001,

  // Character types
  "char[]": 1002,
  "name[]": 1003,
  "text[]": 1009,
  "bpchar[]": 1014,
  "varchar[]": 1015,

  // Numeric types
  "int2[]": 1005,
  "int4[]": 1007,
  "int8[]": 1016,
  "float4[]": 1021,
  "float8[]": 1022,
  "numeric[]": 1231,

  // Date/Time types
  "date[]": 1182,
  "time[]": 1183,
  "timestamp[]": 1115,
  "timestamptz[]": 1185,
  "interval[]": 1187,

  // Other types
  "uuid[]": 2951,
  "json[]": 199,
  "jsonb[]": 3807,
};

/**
 * PostgreSQL array OID to type name mapping (OID -> type name)
 * Used for decoding array types from PostgreSQL responses
 */
export const ARRAY_OID_TO_TYPE: Record<number, string> = {
  // Boolean
  1000: "BOOLEAN",

  // Binary
  1001: "BYTEA",

  // Character types
  1002: "CHAR",
  1003: "NAME",
  1009: "TEXT",
  1014: "CHAR",
  1015: "VARCHAR",

  // Numeric types
  1005: "SMALLINT",
  1006: "INT2VECTOR",
  1007: "INTEGER",
  1016: "BIGINT",
  1021: "REAL",
  1022: "DOUBLE PRECISION",
  1231: "NUMERIC",
  791: "MONEY",

  // OID types
  1028: "OID",
  1010: "TID",
  1011: "XID",
  1012: "CID",

  // JSON types
  199: "JSON",
  3802: "JSONB",
  3807: "JSONB",
  4072: "JSONPATH",
  4073: "JSONPATH",

  // XML
  143: "XML",

  // Geometric types
  1017: "POINT",
  1018: "LSEG",
  1019: "PATH",
  1020: "BOX",
  1027: "POLYGON",
  629: "LINE",
  719: "CIRCLE",

  // Network types
  651: "CIDR",
  1040: "MACADDR",
  1041: "INET",
  775: "MACADDR8",
  2951: "UUID",

  // Date/Time types
  1182: "DATE",
  1183: "TIME",
  1115: "TIMESTAMP",
  1185: "TIMESTAMPTZ",
  1187: "INTERVAL",
  1270: "TIMETZ",

  // Bit string types
  1561: "BIT",
  1563: "VARBIT",

  // ACL
  1034: "ACLITEM",

  // System catalog types
  12052: "PG_DATABASE",
  10052: "PG_DATABASE",
};

/**
 * Check if a PostgreSQL type name is a numeric type
 */
export function isNumericType(type: string): boolean {
  switch (type) {
    case "BIT":
    case "VARBIT":
    case "SMALLINT":
    case "INT2VECTOR":
    case "INTEGER":
    case "INT":
    case "BIGINT":
    case "REAL":
    case "DOUBLE PRECISION":
    case "NUMERIC":
    case "MONEY":
      return true;
    default:
      return false;
  }
}

/**
 * Check if a PostgreSQL type name is a JSON type
 */
export function isJsonType(type: string): boolean {
  switch (type) {
    case "JSON":
    case "JSONB":
      return true;
    default:
      return false;
  }
}

/**
 * Get array type name from OID, returns null if not found
 */
export function getArrayTypeName(oid: number): string | null {
  return ARRAY_OID_TO_TYPE[oid] ?? null;
}

/**
 * Get base type OID from type name, returns undefined if not found
 */
export function getBaseTypeOid(typeName: string): number | undefined {
  return BASE_TYPE_OID[typeName];
}

/**
 * Get array type OID from array type token (e.g., "int4[]"), returns undefined if not found
 */
export function getArrayTypeOid(typeToken: string): number | undefined {
  return ARRAY_TYPE_OID[typeToken];
}

/**
 * Check if a type token is a supported base type for binary encoding
 */
export function isSupportedBaseType(token: string): boolean {
  return Object.hasOwn(BASE_TYPE_OID, token);
}

/**
 * Check if a type token is a supported array type for binary encoding
 */
export function isSupportedArrayType(token: string): boolean {
  return Object.hasOwn(ARRAY_TYPE_OID, token);
}

/**
 * Get list of supported base type names
 */
export function getSupportedBaseTypes(): string[] {
  return Object.keys(BASE_TYPE_OID).sort();
}

/**
 * Get list of supported array type tokens
 */
export function getSupportedArrayTypes(): string[] {
  return Object.keys(ARRAY_TYPE_OID).sort();
}

// Type aliases for backwards compatibility
export const TYPE_OID = BASE_TYPE_OID;
export const TYPE_ARRAY_OID = ARRAY_TYPE_OID;
export const POSTGRES_ARRAY_TYPES = ARRAY_OID_TO_TYPE;
