// bun_sema takes a call of a function of import.meta to leave import.meta as the loader made it: may_modify_import_meta in
// src/sema/bind/runtime/stores.rs names them by hand. These rows of the table of built-ins are what lets it: `require` takes no
// receiver, and the other two read `path` off theirs. A row that says more, like `this: [b.everything]`, needs its function out
// of the list there.
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import type { DumpedEntry } from "../../../src/codegen/builtins/dump";
import { test } from "../supported";

const table = aotBuiltinEntries();
const entries = new Map(table.entries.map(entry => [entry.token, entry]));

test("a function of import.meta reads `path` off its receiver and nothing else", () => {
  const functions = table.entries.filter(
    entry => entry.holder === "ImportMeta" && ["Constructor", "Function", "Method"].includes(entry.kind),
  );
  const rowsOf = (entry: DumpedEntry) => entries.get(entry.sameObjectAs ?? entry.token)!.overloads;
  const doneWithThis = (row: DumpedEntry["overloads"][number]) => ({
    isUndeclared: row.isUndeclared,
    actions: row.propertyActions.filter(action => action.object === "this").length,
    receiver: row.receiver && {
      uses: row.receiver.uses,
      roles: row.receiver.roles,
      protocols: row.receiver.protocols,
      namedMembers: row.receiver.namedMembers,
      calledMembers: row.receiver.calledMembers,
    },
  });
  const readsPath = { uses: ["Inspects"], roles: [], protocols: ["Named"], namedMembers: ["path"], calledMembers: [] };
  expect(Object.fromEntries(functions.map(entry => [entry.name, rowsOf(entry).map(doneWithThis)]))).toEqual({
    require: [{ isUndeclared: false, actions: 0, receiver: null }],
    resolve: [{ isUndeclared: false, actions: 0, receiver: readsPath }],
    resolveSync: [{ isUndeclared: false, actions: 0, receiver: readsPath }],
  });
});
