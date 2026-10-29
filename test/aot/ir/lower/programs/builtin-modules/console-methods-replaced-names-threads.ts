// RUN: lower
// OPTIONS: builtin-modules

// Every method of `console` is replaced in a loop over its names and put back: the names come from an array, from an array of 40 with names that `console` does not have, from Object.keys(console) and from a Set.
// Each is an assignment in compiled code under a key that only the run knows, so it works, and a call of the method afterwards finds what was stored.
// node:worker_threads stores into the global `console`, so with this import the compiler no longer knows that `console` is the built-in object alone.
import { isMainThread } from "node:worker_threads";

const lines: string[] = [];
const con = console as unknown as Record<string, unknown>;

function replaceAll(names: Iterable<string>, tag: string): () => void {
  const originals = new Map<string, unknown>();
  let count = 0;
  for (const name of names) {
    if (name in con && typeof con[name] !== "function") continue;
    originals.set(name, con[name]);
    con[name] = (...args: unknown[]) => {
      lines.push(tag + ":" + name + "(" + args.join(",") + ")");
    };
    count++;
  }
  lines.push(tag + " replaced " + (count >= 14 ? "at least 14" : String(count)));
  return () => {
    for (const [name, original] of originals) {
      if (original === undefined) delete con[name];
      else con[name] = original;
    }
  };
}

function callSome(): void {
  console.log(1);
  console.info(2);
  console.dir(3);
  console.count("4");
  console.countReset("5");
  console.group(6);
  console.groupEnd();
  console.table(7);
  console.time("8");
  console.timeEnd("9");
  console.timeLog("10");
}

const fourteen = ["log", "info", "debug", "dir", "dirxml", "count", "countReset", "group", "groupCollapsed", "groupEnd", "table", "time", "timeEnd", "timeLog"];
const forty = [...fourteen, "warn", "error", "trace", "assert", "clear", "profile", "profileEnd", "timeStamp"];
for (let index = forty.length; index < 40; index++) forty.push("added" + index);

let restore = replaceAll(fourteen, "array");
callSome();
restore();

restore = replaceAll(forty, "forty");
callSome();
console.warn(11);
console.assert(false, 12);
(con.added39 as (value: number) => void)(13);
restore();
lines.push("added39 is " + typeof con.added39);

restore = replaceAll(Object.keys(console), "keys");
callSome();
restore();

restore = replaceAll(new Set(fourteen), "set");
callSome();
restore();

console.log(lines.join("\n"));
console.log(isMainThread);

// GENERATED: callSome
// CHECK-LABEL: function {{*}}name="callSome"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="info"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleInfo) flags=[IsExpected]}
// CHECK-NEXT: v12 = Integer integer=2
// CHECK-NEXT: v13 = Call v11, v9, v12 calleeKey="info" calleeName="console.info"
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="dir"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleDir) flags=[IsExpected]}
// CHECK-NEXT: v19 = Integer integer=3
// CHECK-NEXT: v20 = Call v18, v16, v19 calleeKey="dir" calleeName="console.dir"
// CHECK-NEXT: v21 = Builtin builtin=GlobalThis
// CHECK-NEXT: v22 = PropGet v21 key="console" [isFreeName]
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v23 key="count"
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(ConsoleCount) flags=[IsExpected]}
// CHECK-NEXT: v26 = String string="4"
// CHECK-NEXT: v27 = Call v25, v23, v26 calleeKey="count" calleeName="console.count"
// CHECK-NEXT: v28 = Builtin builtin=GlobalThis
// CHECK-NEXT: v29 = PropGet v28 key="console" [isFreeName]
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v30 key="countReset"
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(ConsoleCountReset) flags=[IsExpected]}
// CHECK-NEXT: v33 = String string="5"
// CHECK-NEXT: v34 = Call v32, v30, v33 calleeKey="countReset" calleeName="console.countReset"
// CHECK-NEXT: v35 = Builtin builtin=GlobalThis
// CHECK-NEXT: v36 = PropGet v35 key="console" [isFreeName]
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v38 = PropGet v37 key="group"
// CHECK-NEXT: v39 = Convert v38 declared={type=builtin(ConsoleGroup) flags=[IsExpected]}
// CHECK-NEXT: v40 = Integer integer=6
// CHECK-NEXT: v41 = Call v39, v37, v40 calleeKey="group" calleeName="console.group"
// CHECK-NEXT: v42 = Builtin builtin=GlobalThis
// CHECK-NEXT: v43 = PropGet v42 key="console" [isFreeName]
// CHECK-NEXT: v44 = Convert v43 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v45 = PropGet v44 key="groupEnd"
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(ConsoleGroupEnd) flags=[IsExpected]}
// CHECK-NEXT: v47 = Call v46, v44 calleeKey="groupEnd" calleeName="console.groupEnd"
// CHECK-NEXT: v48 = Builtin builtin=GlobalThis
// CHECK-NEXT: v49 = PropGet v48 key="console" [isFreeName]
// CHECK-NEXT: v50 = Convert v49 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v51 = PropGet v50 key="table"
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(ConsoleTable) flags=[IsExpected]}
// CHECK-NEXT: v53 = Integer integer=7
// CHECK-NEXT: v54 = Call v52, v50, v53 calleeKey="table" calleeName="console.table"
// CHECK-NEXT: v55 = Builtin builtin=GlobalThis
// CHECK-NEXT: v56 = PropGet v55 key="console" [isFreeName]
// CHECK-NEXT: v57 = Convert v56 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v58 = PropGet v57 key="time"
// CHECK-NEXT: v59 = Convert v58 declared={type=builtin(ConsoleTime) flags=[IsExpected]}
// CHECK-NEXT: v60 = String string="8"
// CHECK-NEXT: v61 = Call v59, v57, v60 calleeKey="time" calleeName="console.time"
// CHECK-NEXT: v62 = Builtin builtin=GlobalThis
// CHECK-NEXT: v63 = PropGet v62 key="console" [isFreeName]
// CHECK-NEXT: v64 = Convert v63 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v65 = PropGet v64 key="timeEnd"
// CHECK-NEXT: v66 = Convert v65 declared={type=builtin(ConsoleTimeEnd) flags=[IsExpected]}
// CHECK-NEXT: v67 = String string="9"
// CHECK-NEXT: v68 = Call v66, v64, v67 calleeKey="timeEnd" calleeName="console.timeEnd"
// CHECK-NEXT: v69 = Builtin builtin=GlobalThis
// CHECK-NEXT: v70 = PropGet v69 key="console" [isFreeName]
// CHECK-NEXT: v71 = Convert v70 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v72 = PropGet v71 key="timeLog"
// CHECK-NEXT: v73 = Convert v72 declared={type=builtin(ConsoleTimeLog) flags=[IsExpected]}
// CHECK-NEXT: v74 = String string="10"
// CHECK-NEXT: v75 = Call v73, v71, v74 calleeKey="timeLog" calleeName="console.timeLog"
// CHECK-NEXT: v76 = Undefined
// CHECK-NEXT: Return v76
// CHECK-NEXT: }
