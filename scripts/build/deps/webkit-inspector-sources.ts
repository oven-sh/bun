/**
 * Inspector (JSC's remote inspector protocol and its bindings generator) file lists for the WebKit source build (deps/webkit.ts): what
 * WebKit's cmake would compile, generate and install for the JSCOnly port
 * with bun's options, written out (Source/JavaScriptCore/CMakeLists.txt: JavaScriptCore_INSPECTOR_DOMAINS,
 * the inspector/scripts generator and its codegen/ modules, and the
 * per-platform RemoteInspectorSocket backend).
 * Paths are relative to Source/JavaScriptCore.
 *
 * Maintained by hand on a WebKit bump: a file added, removed or renamed
 * upstream shows up as "no such file" at compile time or an undefined /
 * duplicate symbol at link; fix the list (.claude/commands/upgrade-webkit.md
 * says which cmake variable maps to which list).
 */

import type { Config } from "../config.ts";

/** JavaScriptCore_INSPECTOR_DOMAINS: protocol JSON combined into CombinedDomains.json. */
export const jscInspectorDomains: readonly string[] = [
  "inspector/protocol/Animation.json",
  "inspector/protocol/Audit.json",
  "inspector/protocol/Browser.json",
  "inspector/protocol/CPUProfiler.json",
  "inspector/protocol/CSS.json",
  "inspector/protocol/Canvas.json",
  "inspector/protocol/Console.json",
  "inspector/protocol/DOM.json",
  "inspector/protocol/DOMDebugger.json",
  "inspector/protocol/DOMStorage.json",
  "inspector/protocol/Debugger.json",
  "inspector/protocol/GenericTypes.json",
  "inspector/protocol/Heap.json",
  "inspector/protocol/IndexedDB.json",
  "inspector/protocol/Inspector.json",
  "inspector/protocol/LayerTree.json",
  "inspector/protocol/Memory.json",
  "inspector/protocol/Network.json",
  "inspector/protocol/Page.json",
  "inspector/protocol/Recording.json",
  "inspector/protocol/Runtime.json",
  "inspector/protocol/ScriptProfiler.json",
  "inspector/protocol/Security.json",
  "inspector/protocol/ServiceWorker.json",
  "inspector/protocol/Storage.json",
  "inspector/protocol/Target.json",
  "inspector/protocol/Timeline.json",
  "inspector/protocol/Worker.json",
  "inspector/protocol/LifecycleReporter.json",
  "inspector/protocol/TestReporter.json",
  "inspector/protocol/BunFrontendDevServer.json",
  "inspector/protocol/HTTPServer.json",
  "inspector/protocol/File.json",
  "inspector/protocol/Process.json",
];

/** JavaScriptCore_SOURCES: compiled outside the unified bundles (the generated JSCBuiltins.cpp is added by the emitter). */
export function jscExtraSourcesFor(cfg: Config): string[] {
  return [
    cfg.windows
      ? "inspector/remote/socket/win/RemoteInspectorSocketWin.cpp"
      : "inspector/remote/socket/posix/RemoteInspectorSocketPOSIX.cpp",
  ];
}

/** inspector/scripts/*.py and codegen/*.py — inputs of the inspector protocol bindings step. */
export const jscInspectorScripts: readonly string[] = [
  "inspector/scripts/generate-inspector-protocol-bindings.py",
  "inspector/scripts/codegen/__init__.py",
  "inspector/scripts/codegen/cpp_generator.py",
  "inspector/scripts/codegen/cpp_generator_templates.py",
  "inspector/scripts/codegen/generate_cpp_alternate_backend_dispatcher_header.py",
  "inspector/scripts/codegen/generate_cpp_backend_dispatcher_header.py",
  "inspector/scripts/codegen/generate_cpp_backend_dispatcher_implementation.py",
  "inspector/scripts/codegen/generate_cpp_frontend_dispatcher_header.py",
  "inspector/scripts/codegen/generate_cpp_frontend_dispatcher_implementation.py",
  "inspector/scripts/codegen/generate_cpp_protocol_types_header.py",
  "inspector/scripts/codegen/generate_cpp_protocol_types_implementation.py",
  "inspector/scripts/codegen/generate_js_backend_commands.py",
  "inspector/scripts/codegen/generate_objc_backend_dispatcher_header.py",
  "inspector/scripts/codegen/generate_objc_backend_dispatcher_implementation.py",
  "inspector/scripts/codegen/generate_objc_configuration_header.py",
  "inspector/scripts/codegen/generate_objc_configuration_implementation.py",
  "inspector/scripts/codegen/generate_objc_frontend_dispatcher_implementation.py",
  "inspector/scripts/codegen/generate_objc_header.py",
  "inspector/scripts/codegen/generate_objc_internal_header.py",
  "inspector/scripts/codegen/generate_objc_protocol_type_conversions_header.py",
  "inspector/scripts/codegen/generate_objc_protocol_type_conversions_implementation.py",
  "inspector/scripts/codegen/generate_objc_protocol_types_implementation.py",
  "inspector/scripts/codegen/generator.py",
  "inspector/scripts/codegen/generator_templates.py",
  "inspector/scripts/codegen/models.py",
  "inspector/scripts/codegen/objc_generator.py",
  "inspector/scripts/codegen/objc_generator_templates.py",
];
