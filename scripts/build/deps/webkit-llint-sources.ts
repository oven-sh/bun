/**
 * LLInt (JSC's low-level interpreter) file lists for the WebKit source build (deps/webkit.ts): what
 * WebKit's cmake would compile, generate and install for the JSCOnly port
 * with bun's options, written out (Source/JavaScriptCore/CMakeLists.txt:
 * LLINT_ASM and OFFLINE_ASM, the offlineasm ruby the extractor and assembly
 * steps run).
 * Paths are relative to Source/JavaScriptCore.
 *
 * Maintained by hand on a WebKit bump: a file added, removed or renamed
 * upstream shows up as "no such file" at compile time or an undefined /
 * duplicate symbol at link; fix the list (.claude/commands/upgrade-webkit.md
 * says which cmake variable maps to which list).
 */

/** LLINT_ASM: the offlineasm inputs (LowLevelInterpreter.asm includes the rest). */
export const llintAsm: readonly string[] = [
  "llint/InPlaceInterpreter.asm",
  "llint/InPlaceInterpreter64.asm",
  "llint/LowLevelInterpreter.asm",
  "llint/LowLevelInterpreter64.asm",
];

/** offlineasm/*.rb — inputs of the LLInt generator steps. */
export const jscOfflineasmRuby: readonly string[] = [
  "offlineasm/arm64.rb",
  "offlineasm/arm64e.rb",
  "offlineasm/asm.rb",
  "offlineasm/ast.rb",
  "offlineasm/backends.rb",
  "offlineasm/cloop.rb",
  "offlineasm/config.rb",
  "offlineasm/generate_offset_extractor.rb",
  "offlineasm/generate_settings_extractor.rb",
  "offlineasm/instructions.rb",
  "offlineasm/offsets.rb",
  "offlineasm/opt.rb",
  "offlineasm/parser.rb",
  "offlineasm/registers.rb",
  "offlineasm/risc.rb",
  "offlineasm/riscv64.rb",
  "offlineasm/self_hash.rb",
  "offlineasm/settings.rb",
  "offlineasm/transform.rb",
  "offlineasm/x86.rb",
];
