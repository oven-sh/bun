import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::api::js_type_checker" });

/** A `string` or `URL`; validated and copied by Rust before scheduling. */
const TypeCheckerPath = b.any;

export const TypeCheckerOptions = b.dictionary(
  {
    cwd: TypeCheckerPath,
  },
  { allowArray: true },
);

export const TypeCheckerSnapshotUpdate = b.dictionary(
  {
    openProjects: b.any,
    closeProjects: b.any,
    sourceChanges: b.any,
  },
  { allowArray: true },
);

const snapshotPromise = b.any.returning(
  table.instance("Promise").holding({ value: table.any, reason: table.any }).spec,
);

export const TypeChecker = b.class({
  rustPath: "crate::api::js_type_checker::TypeChecker",
  refCounted: true,
  final: false,
  construct: {
    args: { options: TypeCheckerOptions.nullable },
    capability: "js",
    throws: true,
    length: 0,
  },
  proto: {
    updateSnapshot: {
      args: { update: TypeCheckerSnapshotUpdate.nullable },
      returns: snapshotPromise,
      capability: "js",
      throws: true,
      length: 0,
      passThis: true,
    },
    close: {
      returns: b.any.returning("Promise"),
      capability: "js",
      throws: true,
    },
    "@@asyncDispose": {
      returns: b.any.returning("Promise"),
      capability: "js",
      throws: true,
    },
  },
});

export const TypeCheckerProgram = b.class({
  rustPath: "crate::api::js_type_checker::TypeCheckerProgram",
  refCounted: true,
  construct: "illegal",
  proto: {
    getDiagnostics: {
      args: { file: TypeCheckerPath },
      returns: b.any.returning(table.instance("Promise").holding({ value: table.any, reason: table.any }).spec),
      capability: "js",
      throws: true,
      length: 0,
    },
  },
});

export const TypeCheckerProject = b.class({
  rustPath: "crate::api::js_type_checker::TypeCheckerProject",
  refCounted: true,
  construct: "illegal",
  proto: {
    configFileName: {
      getter: b.string.local,
      capability: "js",
      throws: true,
    },
    program: {
      getter: TypeCheckerProgram,
      capability: "js",
      throws: true,
    },
  },
});

export const TypeCheckerSnapshot = b.class({
  rustPath: "crate::api::js_type_checker::TypeCheckerSnapshot",
  refCounted: true,
  construct: "illegal",
  proto: {
    getProjects: {
      returns: b.any.returning(table.instance("Array").holding({ element: table.any }).fresh.spec),
      capability: "js",
      throws: true,
    },
    getProject: {
      args: { configFile: TypeCheckerPath },
      returns: TypeCheckerProject.optional,
      capability: "js",
      throws: true,
    },
    dispose: {
      builtin: true,
      length: 0,
    },
    "@@dispose": {
      capability: "js",
      rustName: "dispose",
    },
  },
});
