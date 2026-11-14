/**
 * Dawn — Chromium's implementation of WebGPU, with Tint, its shader compiler. Backs `navigator.gpu`.
 *
 * One backend per platform: D3D12 on Windows, Metal on macOS, Vulkan elsewhere. None of their libraries is linked:
 * they are loaded by the first `requestAdapter()`. Dawn does that by itself but for Metal (src/dawn_sys/MetalSoftLink.h).
 *
 * To update: take the commits of abseil, spirv-headers, vulkan-headers and vulkan-utility-libraries from Dawn's DEPS,
 * and compare the lists at the end of this file with the `CMakeLists.txt` of src/dawn/{common,native} and the
 * `BUILD.cmake` files under src/tint. They leave out what nothing refers to.
 */

import { join } from "node:path";
import type { Config } from "../config.ts";
import { quote } from "../shell.ts";
import type { Dependency, DirectSource, GenStep, SourceGroup } from "../source.ts";
import { depBuildDir, depSourceDir } from "../source.ts";

const DAWN_COMMIT = "e327e2a60b08179ee8a04056f58dad8ca4b69b5f"; // v20261111.144539

export const usesVulkan = (cfg: Config): boolean => !cfg.windows && !cfg.darwin;

/** The description of webgpu.h, which src/codegen/generate-dawn-sys.ts reads as well. */
export const dawnJson = (cfg: Config): string => join(depSourceDir(cfg, "dawn"), "src/dawn/dawn.json");

/** What that script writes for C++. */
export const dawnSysChecks = (cfg: Pick<Config, "codegenDir">): string => join(cfg.codegenDir, "DawnSysChecks.cpp");

/** Abseil's ABI follows the language standard, so it is compiled with the same flags. */
export function dawnCxxFlags(cfg: Config): string[] {
  return [
    "-w",
    ...(cfg.windows
      ? ["/std:c++20", "-D_HAS_EXCEPTIONS=0", "-DNOMINMAX", "-DWIN32_LEAN_AND_MEAN", "-D_CRT_SECURE_NO_WARNINGS"]
      : // Forced vtables instantiate destructors where Dawn's headers have only declared what they destroy.
        ["-std=c++20", "-fno-force-emit-vtables"]),
    ...(cfg.release
      ? [
          cfg.windows ? "/clang:-Os" : "-Os",
          `-I${quote(join(cfg.cwd, "src/banned-includes"), cfg.host.os === "windows")}`,
        ]
      : []),
  ];
}

function generators(cfg: Config): GenStep[] {
  const dawn = depSourceDir(cfg, "dawn");
  const jinja = depSourceDir(cfg, "jinja");
  const markupsafe = depSourceDir(cfg, "markupsafe");
  const generated = join(depBuildDir(cfg, "dawn"), "gen");
  const json = (name: string) => join(dawn, "src/dawn", `${name}.json`);

  const step = (script: string, args: string[], reads: string[], templates: string[], outputs: string[]): GenStep => ({
    desc: `dawn/${script}`,
    cwd: generated,
    cmd: [
      ...[cfg.host.os === "windows" ? "python" : "python3", "-B", join(dawn, "generator", script), ...args],
      ...["--template-dir", join(dawn, "generator/templates"), "--output-dir", generated],
      ...["--jinja2-path", join(jinja, "src/jinja2"), "--markupsafe-path", join(markupsafe, "src/markupsafe")],
    ],
    inputs: [
      ...reads,
      ...[script, "dawn_json_parsing.py", "generator_lib.py"].map(file => join(dawn, "generator", file)),
      ...templates.map(file => join(dawn, "generator/templates", file)),
      ...[jinja, markupsafe].map(directory => join(directory, ".ref")),
    ],
    outputs: outputs.map(file => join(generated, file)),
  });

  // Without this file the generator asks git, which answers with bun's commit.
  const commitFile = join(depBuildDir(cfg, "dawn"), "commit.txt");
  return [
    step(
      "dawn_version_generator.py",
      ["gen", "--dawn-dir", dawn, "--version-file", commitFile, "--version-json", json("dawn_version")],
      [commitFile, json("dawn_version")],
      ["dawn/dawn_version.h"],
      ["include/dawn/dawn_version.h"],
    ),
    step(
      "dawn_gpu_info_generator.py",
      ["--gpu-info-json", json("gpu_info")],
      [json("gpu_info")],
      ["dawn/common/GPUInfo.h", "dawn/common/GPUInfo.cpp"],
      ["src/dawn/common/GPUInfo_autogen.h", "src/dawn/common/GPUInfo_autogen.cpp"],
    ),
    step(
      "dawn_json_generator.py",
      [
        ...["--dawn-json", json("dawn"), "--native-json", json("dawn_native"), "--addin-jsons", json("dawn_version")],
        ...["--targets", "headers,cpp_headers,native_utils,webgpu_dawn_native_proc"],
      ],
      [json("dawn"), json("dawn_native"), json("dawn_version"), join(dawn, "generator/webgpu_docs_utility.py")],
      API_TEMPLATES,
      API_OUTPUTS,
    ),
  ];
}

export const dawn: Dependency = {
  name: "dawn",
  versionMacro: "DAWN",

  source: () => ({
    kind: "github-archive",
    repo: "google/dawn",
    commit: DAWN_COMMIT,
    // 81,000 of the 86,000 files.
    exclude: ["test/tint", "third_party/gn"],
  }),

  patches: [
    "patches/dawn/d3d12-no-compare-object-handles.patch",
    "patches/dawn/freebsd.patch",
    "patches/dawn/log-errors-only.patch",
    "patches/dawn/metal-no-string-literal.patch",
    "patches/dawn/no-iostream.patch",
    "patches/dawn/no-module-search-path.patch",
    "patches/dawn/tick-after-last-serial.patch",
    "patches/dawn/vulkan-lend-fence.patch",
  ],

  fetchDeps: ["abseil", "jinja", "markupsafe"],

  build: cfg => {
    const vulkan = usesVulkan(cfg);
    const buildDir = depBuildDir(cfg, "dawn");
    const ours = (file: string) => join(cfg.cwd, "src/dawn_sys", file);
    const headersOf = (name: "spirv-headers" | "vulkan-headers" | "vulkan-utility-libraries") =>
      vulkan ? [depSourceDir(cfg, name)] : [];

    const defines = {
      DAWN_HAVE_UTILS_BUILD_CONFIG: 1,
      [`DAWN_ENABLE_BACKEND_${cfg.windows ? "D3D12" : cfg.darwin ? "METAL" : "VULKAN"}`]: 1,
      ...((cfg.debug || cfg.assertions) && { DAWN_ENABLE_ASSERTS: 1 }),
      // d3dcompiler_47.dll comes from System32. By default it has to be beside the executable.
      ...(cfg.windows && { DAWN_FORCE_SYSTEM_COMPONENT_LOAD: 1 }),
      TINT_BUILD_GLSL_VALIDATOR: 0,
      TINT_BUILD_GLSL_WRITER: 0,
      TINT_BUILD_HLSL_WRITER: +cfg.windows,
      TINT_BUILD_IR_BINARY: 0,
      TINT_BUILD_IS_LINUX: +vulkan,
      TINT_BUILD_IS_MAC: +cfg.darwin,
      TINT_BUILD_IS_WIN: +cfg.windows,
      TINT_BUILD_MSL_WRITER: +cfg.darwin,
      TINT_BUILD_NULL_WRITER: 0,
      TINT_BUILD_SPV_READER: 0,
      TINT_BUILD_SPV_WRITER: +vulkan,
      TINT_BUILD_WGSL_READER: 1,
      TINT_BUILD_WGSL_WRITER: 0,
      TINT_ENABLE_IR_DUMPING: 0,
      TINT_ENABLE_IR_VALIDATION_ASSERTS: 0,
    };
    const cxxflags = [...dawnCxxFlags(cfg), ...Object.entries(defines).map(([name, value]) => `-D${name}=${value}`)];

    const spirv = headersOf("spirv-headers");
    const tintFlags = {
      cxxflags,
      includes: [".", "include", depSourceDir(cfg, "abseil"), ...spirv.map(directory => join(directory, "include"))],
      orderOnly: spirv.map(directory => join(directory, ".ref")),
    };
    const tint = Object.entries({ ...TINT, ...(cfg.windows ? TINT_HLSL : cfg.darwin ? TINT_MSL : TINT_SPIRV) });
    const tintSources = (buildsIR: boolean) =>
      tint
        .filter(
          ([directory]) =>
            /ir\/(transform|validator)|\/writer|reader\/(lower|program_to_ir)/.test(directory) === buildsIR,
        )
        .flatMap(([directory, names]) => names.map(name => `src/tint/${directory}/${name}.cc`));

    const steps = generators(cfg);
    const generated = steps.flatMap(step => step.outputs);
    const vulkanHeaders = [...headersOf("vulkan-headers"), ...headersOf("vulkan-utility-libraries")];
    const nativeFlags = {
      cxxflags,
      includes: [
        ...[".", "include", join(buildDir, "gen/include"), join(buildDir, "gen/src"), "src/dawn/partition_alloc"],
        depSourceDir(cfg, "abseil"),
        ...vulkanHeaders.map(directory => join(directory, "include")),
      ],
      orderOnly: [
        ...generated.filter(file => !file.endsWith(".cpp")),
        ...vulkanHeaders.map(directory => join(directory, ".ref")),
      ],
    };

    const native = (names: string[]) => names.map(name => `src/dawn/native/${name}.cpp`);
    const withoutPch = (path: string): DirectSource => ({ path, noPch: true });
    // LTO would take std::stringbuf for the only std::streambuf there is.
    const stringStreams = {
      ...withoutPch(ours("StringStreams.cpp")),
      cflags: ["-fno-lto", "-fno-whole-program-vtables"],
    };
    const backend: Array<string | DirectSource> = cfg.windows
      ? [...native(NATIVE_D3D12), "src/dawn/common/WindowsUtils.cpp", ours("QueueWatcherD3D12.cpp")]
      : cfg.darwin
        ? [
            "src/dawn/common/IOSurfaceUtils.cpp",
            ours("QueueWatcherMetal.cpp"),
            ours("MetalSoftLink.S"),
            withoutPch(ours("MetalSoftLink.cpp")),
          ]
        : [
            ...native(NATIVE_VULKAN),
            ...native(cfg.abi === "android" ? NATIVE_VULKAN_ANDROID : NATIVE_VULKAN_DESKTOP),
            "src/dawn/utils/SystemUtils.cpp",
            ours("QueueWatcherVulkan.cpp"),
          ];

    const groups: SourceGroup[] = [
      {
        name: "dawn-native",
        ...nativeFlags,
        pch: join(buildDir, "dawn-native-pch.h"),
        sources: [
          ...native(NATIVE),
          ...backend,
          ...generated.filter(file => file.endsWith(".cpp")),
          ...COMMON.map(name => `src/dawn/common/${name}.cpp`),
          ...["DawnPlatform", "WorkerThread", "metrics/HistogramMacros"].map(name => `src/dawn/platform/${name}.cpp`),
          ...["assert", "log"].map(name => `src/utils/${name}.cc`),
          ours("Host.cpp"),
          withoutPch(dawnSysChecks(cfg)),
          ...(cfg.abi === "musl" ? [stringStreams] : []),
        ],
      },
      { name: "tint", ...tintFlags, pch: join(buildDir, "tint-pch.h"), sources: tintSources(false) },
      { name: "tint-ir", ...tintFlags, pch: join(buildDir, "tint-ir-pch.h"), sources: tintSources(true) },
    ];
    if (cfg.darwin) {
      groups.push({
        name: "dawn-metal",
        ...nativeFlags,
        cxxflags: [
          ...cxxflags,
          ...["-include", quote(ours("MetalSoftLink.h"), cfg.host.os === "windows")],
          "-fno-constant-cfstrings",
          "-fno-objc-convert-messages-to-runtime-calls",
          "-fno-objc-exceptions",
          "-fno-objc-msgsend-selector-stubs",
        ],
        sources: [...NATIVE_METAL.map(name => `src/dawn/native/${name}.mm`), "src/dawn/common/SystemUtils_mac.mm"],
      });
    }

    const include = (directory: string, names: string[]) =>
      names.map(name => `#include "src/${directory}/${name}.h"\n`).join("");
    return {
      kind: "direct",
      sources: [],
      headers: {
        "commit.txt": DAWN_COMMIT,
        "dawn-native-pch.h": include("dawn/native", NATIVE_PCH),
        "tint-pch.h": include("tint", TINT_PCH),
        "tint-ir-pch.h": include("tint/lang/core", ["ir/builder", "ir/module", "type/manager"]),
      },
      steps,
      groups,
    };
  },

  provides: () => ({ libs: [], includes: [] }),
};

// prettier-ignore
const API_TEMPLATES = [
  "BSD_LICENSE", "api.h", "api_cpp.h", "api_cpp_chained_struct.h", "api_cpp_print.h", "dawn_proc_table.h",
  "dawn/api_structs.cpp.tmpl", "dawn/api_structs.h.tmpl", "dawn/cpp_macros.tmpl", "dawn/dawn_platform.h.tmpl",
  "dawn/wire/client/api.h",
  ...[
    "ChainUtils.cpp", "ChainUtils.h", "Features.h", "Features.inl", "ObjectType.cpp", "ObjectType.h", "ProcTable.cpp",
    "ValidationUtils.cpp", "ValidationUtils.h", "api_StreamImpl.cpp", "api_absl_format.cpp", "api_absl_format.h",
    "api_dawn_native_proc.cpp", "api_structs.cpp", "api_structs.h", "api_structs_defaults.cpp",
    "api_structs_defaults.h", "dawn_platform.h",
  ].map(file => `dawn/native/${file}`),
];

// prettier-ignore
const API_OUTPUTS = [
  "include/webgpu/webgpu_cpp_chained_struct.h",
  ...[
    "dawn_proc_table.h", "webgpu.h", "webgpu_cpp.h", "webgpu_cpp_print.h",
    "wire/client/webgpu.h", "wire/client/webgpu_cpp.h", "wire/client/webgpu_cpp_print.h",
  ].map(file => `include/dawn/${file}`),
  ...[
    "ChainUtils_autogen.cpp", "ChainUtils_autogen.h", "Features_autogen.h", "Features_autogen.inl",
    "ObjectType_autogen.cpp", "ObjectType_autogen.h", "ProcTable.cpp", "ValidationUtils_autogen.cpp",
    "ValidationUtils_autogen.h", "dawn_platform_autogen.h", "webgpu_StreamImpl_autogen.cpp",
    "webgpu_absl_format_autogen.cpp", "webgpu_absl_format_autogen.h", "webgpu_dawn_native_proc.cpp",
    "wgpu_structs_autogen.cpp", "wgpu_structs_autogen.h", "wgpu_structs_defaults_autogen.cpp",
    "wgpu_structs_defaults_autogen.h",
  ].map(file => `src/dawn/native/${file}`),
];

// Precompiled headers cut the time to compile Dawn to less than a third.
// prettier-ignore
const NATIVE_PCH = [
  "Adapter", "BindGroup", "Buffer", "ChainUtils", "CommandEncoder", "ComputePipeline", "Device", "Instance", "Queue",
  "RenderPipeline", "Texture",
];

/** No header of a class with a TINT_INSTANTIATE_TYPEINFO: the file that has it must be the first to use the class. */
// prettier-ignore
const TINT_PCH = [
  "lang/core/enums", "lang/core/number", "utils/containers/hashmap", "utils/containers/unique_allocator",
  "utils/diagnostic/diagnostic", "utils/result", "utils/rtti/switch", "utils/symbol/symbol_table",
  "utils/text/string_stream", "utils/text/styled_text",
];

/** src/tint/<directory>/<name>.cc, for every backend. */
// prettier-ignore
const TINT = {
  "api": ["tint"],
  "api/common": ["vertex_pulling_config"],
  "lang/core": ["binary_op", "enums", "number", "unary_op"],
  "lang/core/constant": ["composite", "eval", "invalid", "manager", "node", "scalar", "splat", "string", "value"],
  "lang/core/intrinsic": ["ctor_conv", "data", "table"],
  "lang/core/ir": [
    "access", "array_count", "binary", "block", "block_param", "break_if", "builder", "builtin_call", "call",
    "clone_context", "constant", "constexpr_if", "construct", "continue", "control_instruction", "convert",
    "core_binary", "core_builtin_call", "core_unary", "disassembler", "discard", "evaluator", "exit", "exit_if",
    "exit_loop", "exit_switch", "function", "function_param", "if", "instruction", "instruction_result",
    "interpolate_string", "let", "load", "load_vector_element", "loop", "member_builtin_call", "module",
    "multi_in_block", "next_iteration", "operand_instruction", "override", "phony", "reflection", "return", "store",
    "store_vector_element", "switch", "swizzle", "terminate_invocation", "terminator", "unary", "undef", "unreachable",
    "unused", "user_call", "value", "var",
  ],
  "lang/core/ir/analysis": ["for_loop_analysis", "integer_range_analysis", "loop_analysis", "subgroup_matrix"],
  "lang/core/ir/transform": [
    "bgra8unorm_polyfill", "binary_polyfill", "binding_remapper", "block_decorated_structs", "builtin_polyfill",
    "builtin_scalarize", "change_immediate_to_uniform", "collapse_subgroup_min_max", "combine_access_instructions",
    "conversion_polyfill", "decompose_access", "demote_to_helper", "direct_variable_access", "lower_swizzle_view",
    "multiplanar_external_texture", "polyfill_bool_vector_dynamic_stores", "prepare_immediate_data", "preserve_padding",
    "prevent_infinite_loops", "propagate_buffer_sizes", "remove_continue_in_switch", "remove_terminator_args",
    "remove_uniform_vector_component_loads", "rename_conflicts", "replace_array_and_buffer_length", "resource_table",
    "robustness", "shader_io", "signed_integer_polyfill", "single_entry_point", "substitute_overrides", "value_to_let",
    "vectorize_scalar_matrix_constructors", "vertex_pulling", "zero_init_workgroup_memory",
  ],
  "lang/core/ir/validator": [
    "validate", "validator", "validator_function", "validator_instructions", "validator_io", "validator_types",
  ],
  "lang/core/type": [
    "abstract_float", "abstract_int", "abstract_numeric", "array", "array_count", "atomic", "bf16", "binding_array",
    "bool", "buffer", "builtin_structs", "depth_multisampled_texture", "depth_texture", "external_texture", "f16",
    "f32", "function", "i32", "i8", "input_attachment", "invalid", "manager", "matrix", "memory_view",
    "multisampled_texture", "node", "numeric_scalar", "pointer", "reference", "resource_table", "resource_type",
    "sampled_texture", "sampler", "sampler_kind", "scalar", "storage_texture", "string", "struct", "subgroup_matrix",
    "swizzle_view", "texel_buffer", "texture", "texture_dimension", "type", "u16", "u32", "u64", "u8", "unique_node",
    "vector", "void",
  ],
  "lang/wgsl": ["enums", "feature_status", "reserved_words"],
  "lang/wgsl/ast": [
    "accessor_expression", "alias", "assignment_statement", "attribute", "binary_expression", "binding_attribute",
    "blend_src_attribute", "block_statement", "bool_literal_expression", "break_if_statement", "break_statement",
    "builder", "builtin_attribute", "call_expression", "call_statement", "case_selector", "case_statement",
    "color_attribute", "compound_assignment_statement", "const", "const_assert", "continue_statement",
    "diagnostic_attribute", "diagnostic_control", "diagnostic_directive", "diagnostic_rule_name", "discard_statement",
    "enable", "expression", "extension", "float_literal_expression", "for_loop_statement", "function",
    "group_attribute", "id_attribute", "identifier", "identifier_expression", "if_statement",
    "increment_decrement_statement", "index_accessor_expression", "input_attachment_index_attribute",
    "int_literal_expression", "interpolate_attribute", "interpolated_string_expression", "invariant_attribute", "let",
    "literal_expression", "location_attribute", "loop_statement", "member_accessor_expression", "module",
    "must_use_attribute", "node", "override", "parameter", "phony_expression", "pipeline_stage", "requires",
    "return_statement", "stage_attribute", "statement", "string_literal_expression", "struct", "struct_member",
    "struct_member_align_attribute", "struct_member_size_attribute", "subgroup_size_attribute", "switch_statement",
    "templated_identifier", "type_decl", "unary_op_expression", "var", "variable", "variable_decl_statement",
    "while_statement", "workgroup_attribute",
  ],
  "lang/wgsl/inspector": ["entry_point", "inspector", "resource_binding"],
  "lang/wgsl/intrinsic": ["ctor_conv", "data"],
  "lang/wgsl/ir": ["atomic_vec2u_to_from_u64", "builtin_call"],
  "lang/wgsl/program": ["program", "program_builder"],
  "lang/wgsl/reader": ["reader"],
  "lang/wgsl/reader/lower": ["lower"],
  "lang/wgsl/reader/parser": ["lexer", "parser", "token"],
  "lang/wgsl/reader/program_to_ir": ["program_to_ir"],
  "lang/wgsl/resolver": [
    "dependency_graph", "incomplete_type", "resolve", "resolver", "sem_helper", "uniformity", "unresolved_identifier",
    "validator",
  ],
  "lang/wgsl/sem": [
    "accessor_expression", "array", "array_count", "behavior", "block_statement", "break_if_statement",
    "builtin_enum_expression", "builtin_fn", "call", "call_target", "expression", "for_loop_statement", "function",
    "function_expression", "if_statement", "index_accessor_expression", "info", "load", "loop_statement", "materialize",
    "member_accessor_expression", "module", "node", "statement", "struct", "switch_statement", "type_expression",
    "value_constructor", "value_conversion", "value_expression", "variable", "while_statement",
  ],
  "utils": ["result"],
  "utils/diagnostic": ["diagnostic", "formatter", "source"],
  "utils/ice": ["debugger", "ice"],
  "utils/rtti": ["castable", "switch"],
  "utils/strconv": ["float_to_string", "parse_num"],
  "utils/symbol": ["generation_id", "symbol", "symbol_table"],
  "utils/text": ["string", "string_stream", "styled_text", "unicode"],
};

// prettier-ignore
const TINT_HLSL = {
  "lang/hlsl": ["builtin_fn"],
  "lang/hlsl/intrinsic": ["data"],
  "lang/hlsl/ir": ["builtin_call", "member_builtin_call", "ternary"],
  "lang/hlsl/type": [
    "byte_address_buffer", "int8_t4_packed", "matrix_layout", "rasterizer_ordered_texture_2d", "uint8_t4_packed",
  ],
  "lang/hlsl/writer": ["writer"],
  "lang/hlsl/writer/common": ["option_helpers", "options", "output"],
  "lang/hlsl/writer/printer": ["printer"],
  "lang/hlsl/writer/raise": [
    "array_offset_from_immediate", "binary_polyfill", "bitcast_polyfill", "builtin_polyfill",
    "decompose_snorm10_10_10_2", "decompose_storage_access", "extract_ternary_values",
    "localize_struct_array_assignment", "pixel_local", "promote_initializers", "raise", "replace_default_only_switch",
    "replace_non_indexable_mat_vec_stores", "replace_subgroup_matrix_init", "resource_table_helper", "shader_io",
    "split_workgroup_atomics",
  ],
  "utils/text_generator": ["text_generator"],
};

// prettier-ignore
const TINT_MSL = {
  "lang/msl": ["builtin_fn"],
  "lang/msl/intrinsic": ["data"],
  "lang/msl/ir": ["builtin_call", "component", "member_builtin_call", "memory_order", "os_log"],
  "lang/msl/type": ["bias", "cooperative_tensor", "gradient", "level", "tensor_inline"],
  "lang/msl/writer": ["writer"],
  "lang/msl/writer/common": ["option_helpers", "options", "output", "printer_support"],
  "lang/msl/writer/printer": ["printer"],
  "lang/msl/writer/raise": [
    "alias_to_let", "argument_buffers", "binary_polyfill", "builtin_polyfill", "convert_print_to_log",
    "cooperative_tensors", "decompose_buffer", "fix_type_layout", "fix_u32_div_mod", "module_constant",
    "module_scope_vars", "raise", "resource_table_helper", "shader_io", "simd_ballot", "switch_return",
    "validate_subgroup_matrix",
  ],
  "utils/text_generator": ["text_generator"],
};

// prettier-ignore
const TINT_SPIRV = {
  "lang/spirv": ["builtin_fn"],
  "lang/spirv/intrinsic": ["data"],
  "lang/spirv/ir": ["binary", "builtin_call", "copy_logical"],
  "lang/spirv/type": ["explicit_layout_array", "image", "literal", "sampled_image"],
  "lang/spirv/writer": ["writer"],
  "lang/spirv/writer/analysis": ["relaxed_precision_decorations"],
  "lang/spirv/writer/common": [
    "binary_writer", "function", "instruction", "module", "operand", "option_helper", "output",
  ],
  "lang/spirv/writer/printer": ["printer"],
  "lang/spirv/writer/raise": [
    "builtin_polyfill", "case_switch_to_if_else", "expand_implicit_splats", "fork_explicit_layout_types",
    "handle_matrix_arithmetic", "keep_binding_array_as_pointer", "merge_return", "pass_matrix_by_pointer", "raise",
    "remove_unreachable_in_loop_continuing", "replace_unsigned_compare_zero", "resource_table_helper", "shader_io",
    "unary_polyfill", "var_for_dynamic_index",
  ],
};

/** src/dawn/common/<name>.cpp */
// prettier-ignore
const COMMON = [
  "Defer", "DynamicLib", "FutureUtils", "GPUInfo", "Math", "MemoryBlockAllocator", "RefCounted", "Result", "Sha3",
  "SlabAllocator", "StringViewUtils", "SystemHandle", "SystemUtils", "ThreadLocal", "WeakRefSupport",
  "WGPUDeviceCallbackInfos",
];

/** src/dawn/native/<name>.cpp */
// prettier-ignore
const NATIVE = [
  "Adapter", "ApplyClearColorValueWithDrawHelper", "AsyncTask", "AttachmentState", "BackendConnection", "BindGroup",
  "BindGroupLayout", "BindGroupLayoutInternal", "BindingInfo", "BlitBufferToDepthStencil", "BlitBufferToTexture",
  "BlitColorToColorWithDraw", "BlitDepthToDepth", "BlitTextureToBuffer", "Blob", "BlobCache", "BuddyAllocator",
  "BuddyMemoryAllocator", "Buffer", "BufferTextureCopyOversizedRow", "CachedObject", "CacheKey", "CacheRequest",
  "CallbackTaskManager", "CommandAllocator", "CommandBuffer", "CommandBufferStateTracker", "CommandEncoder", "Commands",
  "CommandValidation", "CompilationMessages", "ComputePassEncoder", "ComputePipeline", "CopyTextureForBrowserHelper",
  "CreatePipelineAsyncEvent", "dawn_platform", "DawnNative", "Device", "DeviceGuard", "DynamicUploader",
  "EncodingContext", "Error", "ErrorData", "ErrorScope", "EventManager", "ExecutionQueue", "ExternalTexture",
  "Features", "Format", "ImmediatesLayout", "IndirectDrawMetadata", "IndirectDrawValidationEncoder", "Instance",
  "InternalPipelineStore", "Limits", "ObjectBase", "ObjectContentHasher", "PassResourceUsage",
  "PassResourceUsageTracker", "PerStage", "PhysicalDevice", "Pipeline", "PipelineCache", "PipelineLayout",
  "PooledResourceMemoryAllocator", "ProgrammableEncoder", "QueryHelper", "QuerySet", "Queue", "RenderBundle",
  "RenderBundleEncoder", "RenderEncoderBase", "RenderPassEncoder", "RenderPassWorkaroundsHelper", "RenderPipeline",
  "ResourceMemoryAllocation", "ResourceTable", "ResourceTableDefaultResources", "RingBufferAllocator", "Sampler",
  "ScratchBuffer", "ShaderModule", "ShaderModuleParseRequest", "SharedBufferMemory", "SharedFence",
  "SharedResourceMemory", "SharedTextureMemory", "Subresource", "Surface", "SwapChain", "SystemEvent",
  "TexelBufferView", "Texture", "TintUtils", "Toggles", "ValidationUtils", "WaitAnySystemEvent", "WaitListEvent",
  "webgpu_absl_format", "stream/BlobSource", "stream/ByteVectorSink", "utils/NativeHelpers",
];

// prettier-ignore
const NATIVE_D3D12 = [
  "d3d/BackendD3D", "d3d/BlobD3D", "d3d/D3DError", "d3d/DeviceD3D", "d3d/KeyedMutex", "d3d/PhysicalDeviceD3D",
  "d3d/PlatformFunctions", "d3d/QueueD3D", "d3d/ShaderUtils", "d3d/SharedFenceD3D", "d3d/SharedTextureMemoryD3D",
  "d3d/SwapChainD3D", "d3d/UtilsD3D", "d3d12/BackendD3D12", "d3d12/BindGroupD3D12", "d3d12/BindGroupLayoutD3D12",
  "d3d12/BufferD3D12", "d3d12/CommandBufferD3D12", "d3d12/CommandRecordingContext", "d3d12/ComputePipelineD3D12",
  "d3d12/CPUDescriptorHeapAllocationD3D12", "d3d12/D3D12Info", "d3d12/DeviceD3D12",
  "d3d12/GPUDescriptorHeapAllocationD3D12", "d3d12/HeapAllocatorD3D12", "d3d12/HeapD3D12", "d3d12/PageableD3D12",
  "d3d12/PhysicalDeviceD3D12", "d3d12/PipelineLayoutD3D12", "d3d12/PipelineLayoutHandle",
  "d3d12/PlatformFunctionsD3D12", "d3d12/QuerySetD3D12", "d3d12/QueueD3D12", "d3d12/RenderPassBuilderD3D12",
  "d3d12/RenderPipelineD3D12", "d3d12/ResidencyManagerD3D12", "d3d12/ResourceAllocatorManagerD3D12",
  "d3d12/ResourceHeapAllocationD3D12", "d3d12/ResourceTableD3D12", "d3d12/SamplerD3D12", "d3d12/SamplerHeapCacheD3D12",
  "d3d12/ShaderModuleD3D12", "d3d12/ShaderVisibleDescriptorAllocatorD3D12", "d3d12/SharedBufferMemoryD3D12",
  "d3d12/SharedFenceD3D12", "d3d12/SharedTextureMemoryD3D12", "d3d12/StagingDescriptorAllocatorD3D12",
  "d3d12/StreamImplD3D12", "d3d12/SwapChainD3D12", "d3d12/TextureCopySplitter", "d3d12/TextureD3D12",
  "d3d12/UtilsD3D12",
];

// prettier-ignore
const NATIVE_VULKAN = [
  "vulkan/BackendVk", "vulkan/BindGroupLayoutVk", "vulkan/BindGroupVk", "vulkan/BufferVk", "vulkan/CommandBufferVk",
  "vulkan/ComputePipelineVk", "vulkan/CommandRecordingContextVk", "vulkan/DescriptorSetAllocator", "vulkan/DeviceVk",
  "vulkan/FencedDeleter", "vulkan/FramebufferCache", "vulkan/FramebufferFetchHelper", "vulkan/MemoryTypeSelector",
  "vulkan/PhysicalDeviceVk", "vulkan/PipelineCacheVk", "vulkan/PipelineLayoutVk", "vulkan/QuerySetVk", "vulkan/QueueVk",
  "vulkan/RenderPassCache", "vulkan/RenderPipelineVk", "vulkan/ResolveTextureLoadingUtilsVk", "vulkan/ResourceHeapVk",
  "vulkan/ResourceMemoryAllocatorVk", "vulkan/ResourceTableVk", "vulkan/SamplerVk", "vulkan/ShaderModuleVk",
  "vulkan/SharedFenceVk", "vulkan/SharedTextureMemoryVk", "vulkan/StreamImplVk", "vulkan/SwapChainVk",
  "vulkan/TexelBufferViewVk", "vulkan/TextureVk", "vulkan/UtilsVulkan", "vulkan/VulkanError", "vulkan/VulkanExtensions",
  "vulkan/VulkanFunctions", "vulkan/VulkanInfo", "vulkan/external_memory/MemoryService",
  "vulkan/external_memory/MemoryServiceImplementation", "vulkan/external_semaphore/SemaphoreService",
  "vulkan/external_semaphore/SemaphoreServiceImplementation",
  "vulkan/external_semaphore/SemaphoreServiceImplementationFD",
];

const NATIVE_VULKAN_DESKTOP = [
  "vulkan/external_memory/MemoryServiceImplementationDmaBuf",
  "vulkan/external_memory/MemoryServiceImplementationOpaqueFD",
];

const NATIVE_VULKAN_ANDROID = ["AHBFunctions", "vulkan/external_memory/MemoryServiceImplementationAHardwareBuffer"];

/** src/dawn/native/<name>.mm */
// prettier-ignore
const NATIVE_METAL = [
  "metal/BackendMTL", "metal/BindGroupLayoutMTL", "metal/BindGroupMTL", "metal/BufferMTL", "metal/CommandBufferMTL",
  "metal/CommandRecordingContext", "metal/ComputePipelineMTL", "metal/DeviceMTL", "metal/FencedReferencer",
  "metal/MultiDrawEncoder", "metal/PhysicalDeviceMTL", "metal/PipelineLayoutMTL", "metal/QuerySetMTL", "metal/QueueMTL",
  "metal/RenderPipelineMTL", "metal/ResourceTableMTL", "metal/SamplerMTL", "metal/ShaderModuleMTL",
  "metal/SharedFenceMTL", "metal/SharedTextureMemoryMTL", "metal/SwapChainMTL", "metal/TextureMTL", "metal/UtilsMetal",
  "Surface_metal",
];
