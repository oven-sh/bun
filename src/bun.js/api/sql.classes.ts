import { ClassDefinition, define } from "../../codegen/class-definitions";

const types = ["PostgresSQL", "MySQL"];
const classes: ClassDefinition[] = [];
for (const type of types) {
  classes.push(
    define({
      name: `${type}Connection`,
      construct: true,
      finalize: true,
      configurable: false,
      hasPendingActivity: type === "PostgresSQL",
      klass: {
        //   escapeString: {
        //     fn: "escapeString",
        //   },
        //   escapeIdentifier: {
        //     fn: "escapeIdentifier",
        //   },
      },
      JSType: "0b11101110",
      proto: {
        close: {
          fn: "doClose",
        },
        connected: {
          getter: "getConnected",
        },
        ref: {
          fn: "doRef",
        },
        unref: {
          fn: "doUnref",
        },
        flush: {
          fn: "doFlush",
        },
        queries: {
          getter: "getQueries",
          this: true,
        },
        onconnect: {
          getter: "getOnConnect",
          setter: "setOnConnect",
          this: true,
        },
        onclose: {
          getter: "getOnClose",
          setter: "setOnClose",
          this: true,
        },
      },
      values: ["onconnect", "onclose", "queries"],
    }),
  );

  classes.push(
    define({
      name: `${type}Query`,
      construct: true,
      finalize: true,
      configurable: false,
      JSType: "0b11101110",
      klass: {},
      proto: {
        run: {
          fn: "doRun",
          length: 2,
        },
        cancel: {
          fn: "doCancel",
          length: 0,
        },
        done: {
          fn: "doDone",
          length: 0,
        },
        setMode: {
          fn: "setModeFromJS",
          length: 1,
        },
        setPendingValue: {
          fn: "setPendingValueFromJS",
          length: 1,
        },
      },
      values: ["pendingValue", "target", "columns", "binding"],
      estimatedSize: true,
    }),
  );
}

export default classes;
