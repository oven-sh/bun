// Imports WebKit's WebGPU implementation into src/jsc/bindings/webgpu/.
//
// Bun links the JSCOnly build of WebKit, which ships JavaScriptCore, WTF and
// bmalloc but none of WebCore or the WebGPU framework. Everything WebGPU is
// therefore copied into this repository, the same way src/jsc/bindings/webcore/
// carries the pieces of WebCore that bun uses. This script does the copy so
// that the import is reproducible against a newer WebKit: run it with
// vendor/WebKit checked out (scripts/sync-webkit-source.ts), then rebuild and
// re-apply whatever local edits `git diff` shows were lost.
//
//   bun scripts/import-webgpu-from-webkit.ts
//
// What gets copied, and where:
//
//   Source/WebGPU/WGSL                  -> webgpu/WGSL            WGSL -> MSL shader compiler
//   Source/WebGPU/WebGPU                -> webgpu/WebGPU          Metal backend behind the webgpu.h C API
//   Source/WebCore/Modules/WebGPU/InternalAPI     -> webgpu/InternalAPI     abstract interfaces + descriptor structs
//   Source/WebCore/Modules/WebGPU/Implementation  -> webgpu/Implementation  InternalAPI on top of the C API
//   Source/WebCore/Modules/WebGPU/*               -> webgpu/                the JS-facing GPU* objects and their IDL
//   generate-bindings.pl over the IDL             -> webgpu/bindings        JSGPU* wrappers
//
// Dropped on import: everything that needs a DOM, a compositor or a video
// pipeline. Bun has no canvas to present into (GPUCanvasContext,
// GPUPresentationContext, CompositorIntegration), no HTMLVideoElement or
// VideoFrame to import (GPUExternalTexture), no WebXR, and no ImageBitmap to
// copy from (copyExternalImageToTexture). The remaining references to those
// features inside kept files are removed by hand after import; see the list
// at the bottom of this file.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const bunRepo = dirname(import.meta.dir);
const webkit = join(bunRepo, "vendor/WebKit");
const out = join(bunRepo, "src/jsc/bindings/webgpu");

if (!existsSync(join(webkit, "Source/WebGPU/WGSL/WGSL.h"))) {
  console.error("vendor/WebKit is missing or has no Source/WebGPU; run scripts/sync-webkit-source.ts first");
  process.exit(1);
}

const webkitCommit = (await Bun.$`git -C ${webkit} rev-parse HEAD`.text()).trim();

type Rule = { from: RegExp; to: string };

// Rewrites applied to every copied source file.
const commonRules: Rule[] = [
  // WebCore's own headers are included framework-style; here they all sit on the include path.
  { from: /#include <WebCore\/([^>]+)>/g, to: '#include "$1"' },
  // Bun only builds this for macOS. WTF is configured as JSCOnly, where no
  // PLATFORM() macro is ever true, so the Cocoa conditionals are resolved here.
  { from: /PLATFORM\(MAC\)/g, to: "1 /* PLATFORM(MAC) */" },
  { from: /PLATFORM\(COCOA\)/g, to: "1 /* PLATFORM(COCOA) */" },
  { from: /PLATFORM\((MACCATALYST|WATCHOS|APPLETV|VISION|IOS_FAMILY_SIMULATOR|IOS_FAMILY|IOS)\)/g, to: "0 /* PLATFORM($1) */" },
];

// [CallTracer=InspectorCanvasCallTracer] makes every generated operation record
// itself for Web Inspector's canvas recording, which bun does not have. The
// other browser-only attributes (EnabledBySetting, SecureContext) only affect
// how the global constructors are installed, which is done by hand in
// ZigGlobalObject, so they are left alone and the generated code is unaffected.
const droppedIdlAttributes = new Set(["CallTracer"]);

function stripIdlAttributes(idl: string): string {
  return idl.replace(/\[([^\[\]]*)\]/g, (block, inner: string) => {
    const attrs: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of inner) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        attrs.push(current);
        current = "";
      } else current += ch;
    }
    attrs.push(current);
    const kept = attrs.map(a => a.trim()).filter(a => a && !droppedIdlAttributes.has(a.split("=")[0]));
    if (kept.length === attrs.filter(a => a.trim()).length) return block;
    if (!kept.length) return "";
    return inner.includes("\n") ? `[\n${kept.map(a => `    ${a},`).join("\n")}\n]` : `[${kept.join(", ")}]`;
  });
}

// IDL members whose types were dropped above.
const idlRules: Rule[] = [
  { from: / or GPUExternalTexture\)/g, to: ")" },
  { from: /^\s*GPUExternalTextureBindingLayout externalTexture;\n/m, to: "" },
  { from: /^\s*GPUExternalTexture importExternalTexture\([^)]*\);\n\n?/m, to: "" },
  { from: /\n\s*\[CallWith=CurrentScriptExecutionContext\] undefined copyExternalImageToTexture\([^;]*;\n/m, to: "" },
];

function shouldDrop(name: string, dropPatterns: RegExp[]): boolean {
  return dropPatterns.some(p => p.test(name));
}

function copyDir(src: string, dst: string, opts: { keep: RegExp; drop?: RegExp[]; rules?: Rule[] }) {
  mkdirSync(dst, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(src)) {
    if (!opts.keep.test(name)) continue;
    if (opts.drop && shouldDrop(name, opts.drop)) continue;
    if (bunOwned.has(name)) continue;
    let text = readFileSync(join(src, name), "utf8");
    const rules = name.endsWith(".idl") ? idlRules : [...commonRules, ...(opts.rules ?? [])];
    for (const { from, to } of rules) text = text.replace(from, to);
    if (name.endsWith(".idl")) text = stripIdlAttributes(text);
    writeFileSync(join(dst, name), text);
    copied++;
  }
  console.log(`${copied.toString().padStart(4)} files -> ${dst.slice(bunRepo.length + 1)}`);
}

const sourceExt = /\.(cpp|h|mm|idl)$/;

// Files that the import replaces with bun-specific versions; see the
// corresponding files in the output tree. They are never overwritten.
const bunOwned = new Set(["config.h"]);

const dropXR = [/^XR/, /^WebGPUXR/, /XRBinding/, /XRProjectionLayer/, /XRSubImage/, /XRView/, /XREye/, /XRLayerBacking/];
const dropPresentation = [/PresentationContext/, /CompositorIntegration/, /^GPUCanvas/, /^WebGPUCanvas/];
const dropExternalTexture = [/ExternalTexture/];
const dropImageCopy = [/ImageCopyExternalImage/, /ImageCopyTextureTagged/];
const dropDom = [...dropXR, ...dropPresentation, ...dropExternalTexture, ...dropImageCopy, /^NavigatorGPU/];

for (const dir of ["WGSL", "WGSL/AST", "WGSL/Metal", "WebGPU", "InternalAPI", "Implementation", "bindings"]) {
  const d = join(out, dir);
  if (!existsSync(d)) continue;
  for (const name of readdirSync(d)) {
    if (sourceExt.test(name) && !bunOwned.has(name)) rmSync(join(d, name));
  }
}
if (existsSync(out)) {
  for (const name of readdirSync(out)) {
    if (sourceExt.test(name) && !bunOwned.has(name)) rmSync(join(out, name));
  }
}

// ─── WGSL compiler ─────────────────────────────────────────────────────────

const wgslSrc = join(webkit, "Source/WebGPU/WGSL");
copyDir(wgslSrc, join(out, "WGSL"), {
  keep: /\.(cpp|h|rb)$/,
  drop: [/^wgslc\.cpp$/, /^wgslfuzz\.cpp$/, /^config\.h$/, /^WGSLPrefix\.h$/],
});
copyDir(join(wgslSrc, "AST"), join(out, "WGSL/AST"), { keep: /\.(cpp|h)$/ });
copyDir(join(wgslSrc, "Metal"), join(out, "WGSL/Metal"), { keep: /\.(cpp|h)$/ });
cpSync(join(wgslSrc, "generator/main.rb"), join(out, "WGSL/generator/main.rb"));

// TypeDeclarations.h / TypeOverloads.h are generated by a ruby script in
// WebKit's build. Ruby is not a bun build dependency, so the output is
// checked in next to its inputs.
await Bun.$`ruby ${join(out, "WGSL/generator/main.rb")} ${join(out, "WGSL/TypeDeclarations.rb")} ${join(out, "WGSL/TypeDeclarations.h")} ${join(out, "WGSL/TypeOverloads.h")}`;
console.log("     generated WGSL/TypeDeclarations.h, WGSL/TypeOverloads.h");

// ─── Metal backend ─────────────────────────────────────────────────────────

copyDir(join(webkit, "Source/WebGPU/WebGPU"), join(out, "WebGPU"), {
  keep: /\.(h|mm)$/,
  drop: [...dropXR, ...dropExternalTexture, /^PresentationContextIOSurface/, /^config\.h$/, /^WebGPUPrefix\.h$/],
});

// ─── WebCore glue ──────────────────────────────────────────────────────────

const modules = join(webkit, "Source/WebCore/Modules/WebGPU");
copyDir(join(modules, "InternalAPI"), join(out, "InternalAPI"), {
  keep: /\.h$/,
  drop: [...dropXR, ...dropPresentation, ...dropExternalTexture, ...dropImageCopy],
});
copyDir(join(modules, "Implementation"), join(out, "Implementation"), {
  keep: /\.(cpp|h)$/,
  drop: [...dropXR, ...dropPresentation, ...dropExternalTexture],
});
copyDir(modules, out, { keep: sourceExt, drop: dropDom });

// ─── JS bindings ───────────────────────────────────────────────────────────

const scripts = join(webkit, "Source/WebCore/bindings/scripts");
const idlDir = out;
const idls = readdirSync(idlDir)
  .filter(n => n.endsWith(".idl"))
  .sort()
  .map(n => join(idlDir, n));
// Interfaces the GPU IDL inherits from. The generator only reads these to
// learn about the parent; the wrappers themselves already exist in webcore/.
const externalIdls = [
  ...["EventTarget", "Event", "EventInit"].map(n => join(bunRepo, "src/jsc/bindings/webcore", `${n}.idl`)),
  join(webkit, "Source/WebCore/dom/DOMException.idl"),
];

const tmp = join(bunRepo, "build/webgpu-idl");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const idlList = join(tmp, "idl-files.txt");
writeFileSync(idlList, [...idls, ...externalIdls].join("\n") + "\n");

const supplemental = join(tmp, "supplemental-dependencies.txt");
const unused = (name: string) => join(tmp, name);
await Bun.$`perl -I${scripts} ${join(scripts, "preprocess-idls.pl")} \
  --defines "" \
  --idlFileNamesList ${idlList} \
  --idlAttributesFile ${join(scripts, "IDLAttributes.json")} \
  --supplementalDependencyFile ${supplemental} \
  --isoSubspacesHeaderFile ${join(tmp, "DOMIsoSubspaces.h")} \
  --clientISOSubspacesHeaderFile ${join(tmp, "DOMClientIsoSubspaces.h")} \
  --constructorsHeaderFile ${join(tmp, "DOMConstructors.h")} \
  --windowConstructorsFile ${join(tmp, "WindowConstructors.idl")} \
  --workerGlobalScopeConstructorsFile ${join(tmp, "WorkerGlobalScopeConstructors.idl")} \
  --shadowRealmGlobalScopeConstructorsFile ${unused("ShadowRealm.idl")} \
  --dedicatedWorkerGlobalScopeConstructorsFile ${unused("DedicatedWorker.idl")} \
  --serviceWorkerGlobalScopeConstructorsFile ${unused("ServiceWorker.idl")} \
  --sharedWorkerGlobalScopeConstructorsFile ${unused("SharedWorker.idl")} \
  --workletGlobalScopeConstructorsFile ${unused("Worklet.idl")} \
  --paintWorkletGlobalScopeConstructorsFile ${unused("PaintWorklet.idl")} \
  --audioWorkletGlobalScopeConstructorsFile ${unused("AudioWorklet.idl")} \
  --testGlobalScopeConstructorsFile ${unused("TestGlobal.idl")}`;

const bindingsDir = join(out, "bindings");
mkdirSync(bindingsDir, { recursive: true });
await Bun.$`perl -I${scripts} ${join(scripts, "generate-bindings.pl")} \
  --defines "" \
  --generator JS \
  --outputDir ${bindingsDir} \
  --idlAttributesFile ${join(scripts, "IDLAttributes.json")} \
  --idlFileNamesList ${idlList} \
  --supplementalDependencyFile ${supplemental} \
  ${idls}`;
for (const name of readdirSync(bindingsDir)) {
  if (!/\.(cpp|h)$/.test(name)) {
    rmSync(join(bindingsDir, name));
    continue;
  }
  let text = readFileSync(join(bindingsDir, name), "utf8");
  for (const { from, to } of commonRules) text = text.replace(from, to);
  writeFileSync(join(bindingsDir, name), text);
}
console.log(`${readdirSync(bindingsDir).length.toString().padStart(4)} files -> src/jsc/bindings/webgpu/bindings`);
console.log(`     iso subspace / constructor lists left in ${tmp.slice(bunRepo.length + 1)} for merging into webcore/DOM*.h`);

writeFileSync(
  join(out, "WEBKIT_COMMIT"),
  `${webkitCommit}\n`,
);
console.log(`imported from WebKit ${webkitCommit}`);

// Hand edits expected after a fresh import (the diff against the previous
// import shows them; this list is what to look for):
//   - GPU / WebGPU / WebGPUImpl: presentation context and compositor integration factories
//   - GPUDevice / WebGPUDevice / DeviceImpl / Device.mm: importExternalTexture, XR binding
//   - GPUQueue / WebGPUQueue / QueueImpl: copyExternalImageToTexture
//   - GPUBindGroupEntry, GPUBindGroupLayoutEntry and the backend BindGroup*.mm: external texture bindings
//   - Instance.mm: createSurface (IOSurface presentation)
//   - WebGPUCreateImpl: ProcessIdentity (GPU process resource ownership)
