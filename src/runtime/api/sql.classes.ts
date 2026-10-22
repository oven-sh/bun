import { ClassDefinition, define } from "../../codegen/class-definitions.ts";

const types = ["PostgresSQL", "MySQL"];
const rustPaths = {
  PostgresSQLConnection: "bun_sql_jsc::postgres::PostgresSQLConnection",
  PostgresSQLQuery: "bun_sql_jsc::postgres::PostgresSQLQuery",
  MySQLConnection: "bun_sql_jsc::mysql::js_my_sql_connection::JSMySQLConnection",
  MySQLQuery: "bun_sql_jsc::mysql::js_my_sql_query::JSMySQLQuery",
};
// src/js/private.d.ts declares the PostgresSQL interfaces as extensions of the MySQL ones, and neither class extends the other.
const typeNamed = (name: string) => ({
  path: ["$ZigGeneratedClasses", name],
  isView: name.startsWith("MySQL"),
  typeArguments: [],
});
const classes: ClassDefinition[] = [];
for (const type of types) {
  classes.push(
    define({
      name: `${type}Connection`,
      types: [typeNamed(`${type}Connection`)],
      rustPath: rustPaths[`${type}Connection`],
      noConstructor: true,
      refCounted: true,
      configurable: false,
      hasPendingActivity: type === "PostgresSQL",
      JSType: "0b11101110",
      proto: {
        close: {
          fn: "doClose",
          returns: "undefined",
          checkedAtRuntime: true,
        },
        flush: {
          fn: "doFlush",
          returns: "undefined",
          checkedAtRuntime: true,
        },
        hold: {
          fn: "doHold",
          returns: "undefined",
          checkedAtRuntime: true,
        },
        unhold: {
          fn: "doUnhold",
          returns: "undefined",
          checkedAtRuntime: true,
        },
        inTransaction: {
          getter: "getInTransaction",
          type: "boolean",
        },
        ...(type === "PostgresSQL"
          ? {
              ref: {
                fn: "doRef",
                returns: "undefined",
                checkedAtRuntime: true,
              },
              sasl: {
                getter: "getSasl",
                type: "boolean",
              },
              onnotification: {
                getter: "getOnNotification",
                setter: "setOnNotification",
                this: true,
              },
            }
          : {}),
      },
      values: [
        "onconnect",
        "onclose",
        "onretire",
        "checkServerIdentity",
        "columnTransform",
        ...(type === "PostgresSQL" ? ["onnotification"] : []),
      ],
    }),
  );

  classes.push(
    define({
      name: `${type}Query`,
      types: [typeNamed(`${type}Query`)],
      rustPath: rustPaths[`${type}Query`],
      noConstructor: true,
      refCounted: true,
      configurable: false,
      JSType: "0b11101110",
      proto: {
        run: {
          fn: "doRun",
          returns: "undefined",
          checkedAtRuntime: true,
          length: 2,
        },
        cancel: {
          fn: "doCancel",
          returns: "undefined",
          checkedAtRuntime: true,
          length: 0,
        },
        setMode: {
          fn: "setModeFromJS",
          returns: "undefined",
          checkedAtRuntime: true,
          length: 1,
        },
        setPendingValue: {
          fn: "setPendingValueFromJS",
          returns: "undefined",
          checkedAtRuntime: true,
          length: 1,
        },
        describeResult: {
          fn: "describeResult",
          returns: "object | null",
          checkedAtRuntime: true,
          length: 1,
        },
        ...(type === "PostgresSQL"
          ? {
              setCopy: {
                fn: "setCopy",
                returns: "undefined",
                checkedAtRuntime: true,
                length: 2,
              },
              copyWrite: {
                fn: "copyWrite",
                returns: "boolean",
                checkedAtRuntime: true,
                length: 1,
              },
              copyDone: {
                fn: "copyDone",
                returns: "undefined",
                checkedAtRuntime: true,
                length: 0,
              },
              copyFail: {
                fn: "copyFail",
                returns: "undefined",
                checkedAtRuntime: true,
                length: 1,
              },
              copyResume: {
                fn: "copyResume",
                returns: "undefined",
                checkedAtRuntime: true,
                length: 0,
              },
            }
          : {}),
      },
      values:
        type === "PostgresSQL" ? ["pendingValue", "target", "binding", "copy"] : ["pendingValue", "target", "binding"],
      estimatedSize: true,
    }),
  );
}

export default classes;
