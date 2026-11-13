// What src/runtime/webgpu/webgpu.bind.ts cannot say.
import * as b from "bun-builtins-table";
import * as schema from "../../../runtime/webgpu/webgpu.bind.ts";
import { ClassType } from "../../bindgen-lib-internal.ts";

const classes = Object.entries(schema).flatMap(([name, value]) => (value instanceof ClassType ? name : []));

const heldFromTheStart = (getter: b.TableType) =>
  ({
    getter,
    capability: "heap",
    throws: true,
    uses: { this: b.retainedByNativeCode },
    implementation: b.generic,
  }) satisfies b.GetterField;

export default b.declarations(
  ["navigator.gpu", ...classes].flatMap(path => b.extend(path, { usesFeature: "WebGpu" })),
  // ZigGlobalObject.cpp: the realm makes it at the first read.
  b.method("navigator.gpu", {
    this: b.any,
    getter: b.instance("GPU"),
    capability: "heap",
    uses: { this: b.inspected },
    implementation: b.generic,
  }),
  classes.flatMap(name =>
    b.callOfConstructor(name, { returns: b.never, capability: "heap", throws: true, implementation: b.hostCall }),
  ),
  b.method(
    "GPUCompilationInfo.prototype.messages",
    heldFromTheStart(b.instance("Array").holding({ element: b.instance("GPUCompilationMessage") })),
  ),
  b.method("GPUUncapturedErrorEvent.prototype.error", heldFromTheStart(b.instance("GPUError"))),
);
