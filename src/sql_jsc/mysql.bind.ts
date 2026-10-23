import * as b from "../codegen/bindgen-lib.ts";
import { MySQLConnection } from "./mysql/JSMySQLConnection.bind.ts";
import { MySQLQuery } from "./mysql/JSMySQLQuery.bind.ts";

const js = { capability: "js", throws: true } as const;
const text = b.string.loose.utf8;
const milliseconds = b.f64.loose;

export const binding = b.namespace({
  init: {
    args: { onResolveQuery: b.callable, onRejectQuery: b.callable },
    capability: "heap",
    length: 0,
    rustPath: "crate::mysql::my_sql_context::init",
  },
  createQuery: {
    ...js,
    args: {
      query: b.string.allowStringObject.owned,
      values: b.jsArray,
      pendingValue: b.jsArray,
      bigint: b.bool,
      simple: b.bool,
    },
    expected: { values: "values must be an array" },
    returns: MySQLQuery,
    rustPath: "crate::mysql::js_my_sql_query::JSMySQLQuery::create_query",
  },
  /** The arguments of `NativeCreateConnection` in `src/js/internal/sql/pool.ts`. The ones that are `b.any`, except `tls`, are for Postgres. */
  createConnection: {
    ...js,
    args: {
      hostname: text,
      port: b.f64,
      username: text,
      password: text,
      database: text,
      sslMode: b.u8.validateInteger(0, 4),
      tls: b.any,
      query: b.any,
      path: text,
      onConnected: b.callable,
      onDisconnected: b.callable,
      idleTimeout: milliseconds,
      connectionTimeout: milliseconds,
      maxLifetime: milliseconds,
      useUnnamedPreparedStatements: b.any,
      allowPublicKeyRetrieval: b.bool.loose,
      onRetire: b.callable.optional,
      foundRows: b.bool.loose,
      channelBinding: b.any,
      columnTransform: b.callable.optional,
    },
    returns: MySQLConnection,
    length: 2,
    rustPath: "crate::mysql::js_my_sql_connection::JSMySQLConnection::create_connection",
  },
});
