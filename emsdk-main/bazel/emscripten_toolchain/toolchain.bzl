"""This module encapsulates logic to create emscripten_cc_toolchain_config rule."""

load(
    "@bazel_tools//tools/cpp:cc_toolchain_config_lib.bzl",
    "action_config",
    "env_entry",
    "env_set",
    "feature",
    "feature_set",
    "flag_group",
    "tool",
    "tool_path",
    "variable_with_value",
    "with_feature_set",
    _flag_set = "flag_set",
)
load("@bazel_tools//tools/build_defs/cc:action_names.bzl", "ACTION_NAMES")

def flag_set(flags = None, features = None, not_features = None, **kwargs):
    """Extension to flag_set which allows for a "simple" form.

    The simple form allows specifying flags as a simple list instead of a flag_group
    if enable_if or expand_if semantics are not required.

    Similarly, the simple form allows passing features/not_features if they are a simple
    list of semantically "and" features.
    (i.e. "asan" and "dbg", rather than "asan" or "dbg")

    Args:
      flags: list, set of flags
      features: list, set of features required to be enabled.
      not_features: list, set of features required to not be enabled.
      **kwargs: The rest of the args for flag_set.

    Returns:
      flag_set
    """
    if flags:
        if kwargs.get("flag_groups"):
            fail("Cannot set flags and flag_groups")
        else:
            kwargs["flag_groups"] = [flag_group(flags = flags)]

    if features or not_features:
        if kwargs.get("with_features"):
            fail("Cannot set features/not_feature and with_features")
        kwargs["with_features"] = [with_feature_set(
            features = features or [],
            not_features = not_features or [],
        )]
    return _flag_set(**kwargs)

CROSSTOOL_DEFAULT_WARNINGS = [
    "-Wall",
]

def _impl(ctx):
    target_cpu = ctx.attr.cpu
    toolchain_identifier = "emscripten-" + target_cpu
    target_system_name = target_cpu + "-unknown-emscripten"

    host_system_name = "i686-unknown-linux-gnu"

    target_libc = "musl/js"

    abi_version = "emscripten_syscalls"

    compiler = "emscripten"
    abi_libc_version = "default"

    cc_target_os = "emscripten"

    emscripten_dir = ctx.attr.emscripten_binaries.label.workspace_root

    nodejs_path = ctx.file.nodejs_bin.path

    builtin_sysroot = emscripten_dir + "/emscripten/cache/sysroot"

    emcc_script = "emcc.%s" % ctx.attr.script_extension
    emcc_link_script = "emcc_link.%s" % ctx.attr.script_extension
    emar_script = "emar.%s" % ctx.attr.script_extension

    ################################################################
    # Tools
    ################################################################
    clang_tool = tool(path = emcc_script)
    clif_match_tool = tool(path = "dummy_clif_matcher")
    link_tool = tool(path = emcc_link_script)
    archive_tool = tool(path = emar_script)
    strip_tool = tool(path = "NOT_USED_STRIP_TOOL")

    #### Legacy tool paths (much of this is redundant with action_configs, but
    #### these are still used for some things)
    tool_paths = [
        tool_path(name = "ar", path = emar_script),
        tool_path(name = "cpp", path = "/bin/false"),
        tool_path(name = "gcc", path = emcc_script),
        tool_path(name = "gcov", path = "/bin/false"),
        tool_path(name = "ld", path = emcc_link_script),
        tool_path(name = "nm", path = "NOT_USED"),
        tool_path(name = "objdump", path = "/bin/false"),
        tool_path(name = "strip", path = "NOT_USED"),
    ]

    ################################################################
    # Action Configs
    ################################################################

    cpp_compile_action = action_config(
        action_name = ACTION_NAMES.cpp_compile,
        tools = [clang_tool],
    )

    cpp_module_compile_action = action_config(
        action_name = ACTION_NAMES.cpp_module_compile,
        tools = [clang_tool],
    )

    cpp_module_codegen_action = action_config(
        action_name = ACTION_NAMES.cpp_module_codegen,
        tools = [clang_tool],
    )

    clif_match_action = action_config(
        action_name = ACTION_NAMES.clif_match,
        tools = [clif_match_tool],
    )

    cpp_link_dynamic_library_action = action_config(
        action_name = ACTION_NAMES.cpp_link_dynamic_library,
        tools = [link_tool],
    )

    strip_action = action_config(
        action_name = ACTION_NAMES.strip,
        tools = [strip_tool],
    )

    preprocess_assemble_action = action_config(
        action_name = ACTION_NAMES.preprocess_assemble,
        tools = [clang_tool],
    )

    cpp_header_parsing_action = action_config(
        action_name = ACTION_NAMES.cpp_header_parsing,
        tools = [clang_tool],
    )

    cpp_link_static_library_action = action_config(
        action_name = ACTION_NAMES.cpp_link_static_library,
        enabled = True,
        flag_sets = [
            flag_set(
                flag_groups = [
                    flag_group(
                        flags = ["rcsD", "%{output_execpath}"],
                        expand_if_available = "output_execpath",
                    ),
                ],
            ),
            flag_set(
                flag_groups = [
                    flag_group(
                        iterate_over = "libraries_to_link",
                        flag_groups = [
                            flag_group(
                                flags = ["%{libraries_to_link.name}"],
                                expand_if_equal = variable_with_value(
                                    name = "libraries_to_link.type",
                                    value = "object_file",
                                ),
                            ),
                            flag_group(
                                flags = ["%{libraries_to_link.object_files}"],
                                iterate_over = "libraries_to_link.object_files",
                                expand_if_equal = variable_with_value(
                                    name = "libraries_to_link.type",
                                    value = "object_file_group",
                                ),
                            ),
                        ],
                        expand_if_available = "libraries_to_link",
                    ),
                ],
            ),
            flag_set(
                flag_groups = [
                    flag_group(
                        flags = ["@%{linker_param_file}"],
                        expand_if_available = "linker_param_file",
                    ),
                ],
            ),
        ],
        tools = [archive_tool],
    )

    c_compile_action = action_config(
        action_name = ACTION_NAMES.c_compile,
        tools = [clang_tool],
    )

    linkstamp_compile_action = action_config(
        action_name = ACTION_NAMES.linkstamp_compile,
        tools = [clang_tool],
    )

    assemble_action = action_config(
        action_name = ACTION_NAMES.assemble,
        tools = [clang_tool],
    )

    cpp_link_executable_action = action_config(
        action_name = ACTION_NAMES.cpp_link_executable,
        tools = [link_tool],
    )

    cpp_link_nodeps_dynamic_library_action = action_config(
        action_name = ACTION_NAMES.cpp_link_nodeps_dynamic_library,
        tools = [link_tool],
    )

    action_configs = [
        strip_action,
        c_compile_action,
        cpp_compile_action,
        linkstamp_compile_action,
        assemble_action,
        preprocess_assemble_action,
        cpp_header_parsing_action,
        cpp_module_compile_action,
        cpp_module_codegen_action,
        cpp_link_executable_action,
        cpp_link_dynamic_library_action,
        cpp_link_nodeps_dynamic_library_action,
        cpp_link_static_library_action,
        clif_match_action,
    ]

    all_compile_actions = [
        ACTION_NAMES.c_compile,
        ACTION_NAMES.cpp_compile,
        ACTION_NAMES.linkstamp_compile,
        ACTION_NAMES.assemble,
        ACTION_NAMES.preprocess_assemble,
        ACTION_NAMES.cpp_header_parsing,
        ACTION_NAMES.cpp_module_compile,
        ACTION_NAMES.cpp_module_codegen,
        ACTION_NAMES.clif_match,
        ACTION_NAMES.lto_backend,
    ]

    all_cpp_compile_actions = [
        ACTION_NAMES.cpp_compile,
        ACTION_NAMES.linkstamp_compile,
        ACTION_NAMES.cpp_header_parsing,
        ACTION_NAMES.cpp_module_compile,
        ACTION_NAMES.cpp_module_codegen,
        ACTION_NAMES.clif_match,
    ]

    preprocessor_compile_actions = [
        ACTION_NAMES.c_compile,
        ACTION_NAMES.cpp_compile,
        ACTION_NAMES.linkstamp_compile,
        ACTION_NAMES.preprocess_assemble,
        ACTION_NAMES.cpp_header_parsing,
        ACTION_NAMES.cpp_module_compile,
        ACTION_NAMES.clif_match,
    ]

    all_link_actions = [
        ACTION_NAMES.cpp_link_executable,
        ACTION_NAMES.cpp_link_dynamic_library,
        ACTION_NAMES.cpp_link_nodeps_dynamic_library,
    ]

    ################################################################
    # Features
    ################################################################

    features = [
        # This set of magic "feature"s are important configuration information for blaze.
        feature(name = "no_legacy_features", enabled = True),
        feature(
            name = "has_configured_linker_path",
            enabled = True,
        ),

        # Blaze requests this feature by default, but we don't care.
        feature(name = "dependency_file"),

        # Blaze requests this feature by default, but we don't care.
        feature(name = "random_seed"),

        # Formerly "needsPic" attribute
        feature(name = "supports_pic", enabled = False),

        # Blaze requests this feature by default.
        # Blaze also tests if this feature is supported, before setting the "pic" build-variable.
        feature(name = "pic"),

        # Blaze requests this feature by default.
        # Blaze also tests if this feature is supported before setting preprocessor_defines
        # (...but why?)
        feature(name = "preprocessor_defines"),

        # Blaze requests this feature by default.
        # Blaze also tests if this feature is supported before setting includes. (...but why?)
        feature(name = "include_paths"),

        # Blaze tests if this feature is enabled in order to create implicit
        # "nodeps" .so outputs from cc_library rules.
        feature(name = "supports_dynamic_linker", enabled = False),

        # Blaze requests this feature when linking a cc_binary which is
        # "dynamic" aka linked against nodeps-dynamic-library cc_library
        # outputs.
        feature(name = "dynamic_linking_mode"),

        #### Configuration features
        feature(
            name = "crosstool_cpu",
            enabled = True,
            implies = ["crosstool_cpu_" + target_cpu],
        ),
        feature(
            name = "crosstool_cpu_asmjs",
            provides = ["variant:crosstool_cpu"],
        ),
        feature(
            name = "crosstool_cpu_wasm",
            provides = ["variant:crosstool_cpu"],
        ),

        # These 3 features will be automatically enabled by blaze in the
        # corresponding build mode.
        feature(
            name = "opt",
            provides = ["variant:crosstool_build_mode"],
        ),
        feature(
            name = "dbg",
            provides = ["variant:crosstool_build_mode"],
        ),
        feature(
            name = "fastbuild",
            provides = ["variant:crosstool_build_mode"],
        ),

        # Feature to prevent 'command line too long' issues
        feature(
            name = "archive_param_file",
            enabled = True,
        ),
        feature(
            name = "compiler_param_file",
            enabled = True,
        ),

        #### User-settable features

        # Set if enabling exceptions.
        feature(name = "exceptions"),

        # This feature overrides the default optimization to prefer execution speed
        # over binary size (like clang -O3).
        feature(
            name = "optimized_for_speed",
            provides = ["variant:crosstool_optimization_mode"],
        ),

        # This feature overrides the default optimization to prefer binary size over
        # execution speed (like clang -Oz).
        feature(
            name = "optimized_for_size",
            provides = ["variant:crosstool_optimization_mode"],
        ),

        # Convenience aliases / alt-spellings.
        feature(
            name = "optimize_for_speed",
            implies = ["optimized_for_speed"],
        ),
        feature(
            name = "optimize_for_size",
            implies = ["optimized_for_size"],
        ),

        # This feature allows easier use of profiling tools by preserving mangled
        # C++ names. This does everything profiling_funcs does and more.
        feature(name = "profiling"),

        # This feature emits only enough debug info for function names to appear
        # in profiles.
        feature(name = "profiling_funcs"),

        # This feature allows source maps to be generated.
        feature(
            name = "source_maps",
            implies = ["full_debug_info"],
        ),
        feature(
            name = "dwarf_debug_info",
            implies = ["profiling"],
        ),

        # Turns on full debug info (-g4).
        feature(name = "full_debug_info"),

        # Enables the use of "Emscripten" Pthread implementation.
        # https://kripken.github.io/emscripten-site/docs/porting/pthreads.html
        # https://github.com/kripken/emscripten/wiki/Pthreads-with-WebAssembly
        feature(name = "use_pthreads"),

        # If enabled, the runtime will exit when main() completes.
        feature(name = "exit_runtime"),

        # Primarily for toolchain maintainers:
        feature(name = "emcc_debug"),
        feature(name = "emcc_debug_link"),
        feature(
            name = "llvm_backend",
            requires = [feature_set(features = ["crosstool_cpu_wasm"])],
            enabled = True,
        ),

        # Remove once flag is flipped.
        # See https://github.com/bazelbuild/bazel/issues/7687
        feature(
            name = "do_not_split_linking_cmdline",
        ),

        # Adds simd support, only available with the llvm backend.
        feature(
            name = "wasm_simd",
            requires = [feature_set(features = ["llvm_backend"])],
        ),
        # Adds relaxed-simd support, only available with the llvm backend.
        feature(
            name = "wasm_relaxed_simd",
            requires = [feature_set(features = ["llvm_backend"])],
        ),
        feature(
            name = "precise_long_double_printf",
            enabled = True,
        ),
        feature(
            name = "wasm_warnings_as_errors",
            enabled = False,
        ),

        # ASan and UBSan. See also:
        # https://emscripten.org/docs/debugging/Sanitizers.html
        feature(name = "wasm_asan"),
        feature(name = "wasm_ubsan"),
        feature(
            name = "output_format_js",
            enabled = True,
        ),
        feature(
            name = "wasm_standalone",
        ),
    ]

    crosstool_default_flag_sets = [
        # Compile, Link, and CC_FLAGS make variable
        flag_set(
            actions = [
                ACTION_NAMES.c_compile,
                ACTION_NAMES.cpp_compile,
                ACTION_NAMES.linkstamp_compile,
                ACTION_NAMES.assemble,
                ACTION_NAMES.preprocess_assemble,
                ACTION_NAMES.cpp_header_parsing,
                ACTION_NAMES.cpp_module_compile,
                ACTION_NAMES.cpp_module_codegen,
                ACTION_NAMES.clif_match,
                ACTION_NAMES.cpp_link_executable,
                ACTION_NAMES.cpp_link_dynamic_library,
                ACTION_NAMES.cpp_link_nodeps_dynamic_library,
            ],
            flag_groups = [
                flag_group(
                    flags = ["--sysroot=%{sysroot}"],
                    expand_if_available = "sysroot",
                ),
            ],
        ),
        # Compile + Link
        flag_set(
            actions = [
                ACTION_NAMES.c_compile,
                ACTION_NAMES.cpp_compile,
                ACTION_NAMES.linkstamp_compile,
                ACTION_NAMES.assemble,
                ACTION_NAMES.preprocess_assemble,
                ACTION_NAMES.cpp_header_parsing,
                ACTION_NAMES.cpp_module_compile,
                ACTION_NAMES.cpp_module_codegen,
                ACTION_NAMES.clif_match,
                ACTION_NAMES.cpp_link_executable,
                ACTION_NAMES.cpp_link_dynamic_library,
                ACTION_NAMES.cpp_link_nodeps_dynamic_library,
            ],
            # This forces color diagnostics even on Forge (where we don't have an
            # attached terminal).
            flags = [
                "-fdiagnostics-color",
            ],
        ),
        # C++ compiles (and implicitly link)
        flag_set(
            actions = all_cpp_compile_actions,
            flags = [
                "-fno-exceptions",
            ],
            not_features = ["exceptions"],
        ),
        flag_set(
            actions = all_cpp_compile_actions,
            flags = [
                "-fexceptions",
            ],
            features = ["exceptions"],
        ),
        # All compiles (and implicitly link)
        flag_set(
            actions = all_compile_actions +
                      all_link_actions,
            flags = [
                "-fno-strict-aliasing",
                "-funsigned-char",
                "-no-canonical-prefixes",
            ],
        ),
        # Language Features
        flag_set(
            actions = all_cpp_compile_actions,
            flags = ["-std=gnu++17", "-nostdinc", "-nostdinc++"],
        ),

        # Emscripten-specific settings:
        flag_set(
            actions = all_compile_actions + all_link_actions,
            flags = ["-s", "WASM=0"],
            features = ["crosstool_cpu_asmjs"],
        ),
        flag_set(
            actions = all_compile_actions +
                      all_link_actions,
            flags = ["-s", "USE_PTHREADS=1"],
            features = ["use_pthreads"],
        ),
        flag_set(
            actions = all_link_actions,
            flags = ["-s", "EXIT_RUNTIME=1"],
            features = ["exit_runtime"],
        ),
        flag_set(
            actions = all_compile_actions + all_link_actions,
            flags = ["-pthread"],
            features = ["llvm_backend", "use_pthreads"],
        ),
        flag_set(
            actions = all_compile_actions + all_link_actions,
            flags = ["-msimd128"],
            features = ["wasm_simd"],
        ),
        flag_set(
            actions = all_compile_actions + all_link_actions,
            flags = ["-msimd128", "-mrelaxed-simd"],
            features = ["wasm_relaxed_simd"],
        ),
        flag_set(
            actions = all_link_actions,
            flags = ["-s", "PRINTF_LONG_DOUBLE=1"],
            features = ["precise_long_double_printf"],
        ),
        flag_set(
            actions = all_link_actions,
            flags = ["--oformat=js"],
            features = ["output_format_js"],
        ),

        # Opt
        flag_set(
            actions = preprocessor_compile_actions,
            flags = ["-DNDEBUG"],
            features = ["opt"],
        ),
        flag_set(
            actions = all_compile_actions,
            flags = ["-fomit-frame-pointer"],
            features = ["opt"],
        ),
        flag_set(
            actions = all_compile_actions +
                      all_link_actions,
            flags = ["-O2"],
            features = ["opt"],
        ),

        # Users can override opt-level with semantic names...
        flag_set(
            actions = all_compile_actions +
                      all_link_actions,
            flags = ["-Oz"],
            features = ["optimized_for_size", "opt"],
        ),
        flag_set(
            actions = all_compile_actions +
                      all_link_actions,
            flags = ["-O3"],
            features = ["optimized_for_speed", "opt"],
        ),

        # Fastbuild
        flag_set(
            actions = all_compile_actions,
            flags = ["-fomit-frame-pointer"],
            features = ["fastbuild"],
        ),
        flag_set(
            actions = all_compile_actions +
                      all_link_actions,
            flags = ["-O0"],
            features = ["fastbuild"],
        ),

        # Dbg
        flag_set(
            actions = all_compile_actions,
            flags = ["-fno-omit-frame-pointer"],
            features = ["dbg"],
        ),
        flag_set(
            actions = all_compile_actions +
                      all_link_actions,
            flags = ["-g", "-O0"],
            features = ["dbg"],
        ),
        flag_set(
            actions = all_compile_actions +
                      all_link_actions,
            flags = [
                "-g",
                "-fsanitize=address",
                "-O1",
                "-DADDRESS_SANITIZER=1",
                "-fno-omit-frame-pointer",
            ],
            features = ["wasm_asan"],
        ),
        flag_set(
            actions = all_compile_actions +
                      all_link_actions,
            flags = [
                "-g4",
                "-fsanitize=undefined",
                "-O1",
                "-DUNDEFINED_BEHAVIOR_SANITIZER=1",
                "-fno-omit-frame-pointer",
                "-fno-sanitize=vptr",
            ],
            features = ["wasm_ubsan"],
        ),

        # Profiling provides full debug info and a special --profiling flag
        # to control name mangling
        flag_set(
            actions = all_link_actions,
            flags = ["--profiling"],
            features = ["profiling"],
        ),
        flag_set(
            actions = all_link_actions,
            flags = ["--profiling_funcs"],
            features = ["profiling_funcs"],
        ),
        flag_set(
            actions = all_compile_actions +
                      all_link_actions,
            flags = ["-g4"],
            features = ["full_debug_info"],
        ),
        flag_set(
            actions = all_link_actions,
            flags = ["-gseparate-dwarf"],
            features = ["dwarf_debug_info"],
        ),
        flag_set(
            actions = all_compile_actions +
                      all_link_actions,
            flags = ["-fdebug-compilation-dir=."],
            features = ["dwarf_debug_info"],
        ),
        # Generic warning flag list
        flag_set(
            actions = all_compile_actions,
            flags = CROSSTOOL_DEFAULT_WARNINGS,
        ),

        # Defines and Includes and Paths and such
        flag_set(
            actions = all_compile_actions,
            flag_groups = [
                flag_group(flags = ["-fPIC"], expand_if_available = "pic"),
            ],
        ),
        flag_set(
            actions = preprocessor_compile_actions,
            flag_groups = [
                flag_group(
                    flags = ["-D%{preprocessor_defines}"],
                    iterate_over = "preprocessor_defines",
                ),
            ],
        ),
        flag_set(
            actions = preprocessor_compile_actions,
            flag_groups = [
                flag_group(
                    flags = ["-include", "%{includes}"],
                    iterate_over = "includes",
                    expand_if_available = "includes",
                ),
            ],
        ),
        flag_set(
            actions = preprocessor_compile_actions,
            flag_groups = [
                flag_group(
                    flags = ["-iquote", "%{quote_include_paths}"],
                    iterate_over = "quote_include_paths",
                ),
                flag_group(
                    flags = ["-I%{include_paths}"],
                    iterate_over = "include_paths",
                ),
                flag_group(
                    flags = ["-isystem", "%{system_include_paths}"],
                    iterate_over = "system_include_paths",
                ),
            ],
        ),

        ## Linking options (not libs -- those go last)

        # Generic link options
        flag_set(
            actions = [
                ACTION_NAMES.cpp_link_dynamic_library,
                ACTION_NAMES.cpp_link_nodeps_dynamic_library,
            ],
            flags = ["-shared"],
        ),

        # Linker search paths and objects:
        flag_set(
            actions = all_link_actions,
            flag_groups = [
                flag_group(
                    iterate_over = "runtime_library_search_directories",
                    flag_groups = [
                        flag_group(
                            flags = [
                                "-Wl,-rpath,$EXEC_ORIGIN/%{runtime_library_search_directories}",
                            ],
                            expand_if_true = "is_cc_test",
                        ),
                        flag_group(
                            flags = [
                                "-Wl,-rpath,$ORIGIN/%{runtime_library_search_directories}",
                            ],
                            expand_if_false = "is_cc_test",
                        ),
                    ],
                    expand_if_available = "runtime_library_search_directories",
                ),
            ],
        ),
        flag_set(
            actions = all_link_actions,
            flag_groups = [
                flag_group(
                    flags = ["-L%{library_search_directories}"],
                    iterate_over = "library_search_directories",
                    expand_if_available = "library_search_directories",
                ),
            ],
        ),
        flag_set(
            actions = all_link_actions,
            flag_groups = [
                flag_group(
                    # This is actually a list of object files from the linkstamp steps
                    flags = ["%{linkstamp_paths}"],
                    iterate_over = "linkstamp_paths",
                    expand_if_available = "linkstamp_paths",
                ),
            ],
        ),
        flag_set(
            actions = all_link_actions,
            flag_groups = [
                flag_group(
                    flags = ["@%{thinlto_param_file}"],
                    expand_if_available = "libraries_to_link",
                    expand_if_true = "thinlto_param_file",
                ),
                flag_group(
                    iterate_over = "libraries_to_link",
                    flag_groups = [
                        flag_group(
                            flags = ["-Wl,--start-lib"],
                            expand_if_equal = variable_with_value(
                                name = "libraries_to_link.type",
                                value = "object_file_group",
                            ),
                        ),
                        flag_group(
                            flags = ["-Wl,-whole-archive"],
                            expand_if_true = "libraries_to_link.is_whole_archive",
                        ),
                        flag_group(
                            flags = ["%{libraries_to_link.object_files}"],
                            iterate_over = "libraries_to_link.object_files",
                            expand_if_equal = variable_with_value(
                                name = "libraries_to_link.type",
                                value = "object_file_group",
                            ),
                        ),
                        flag_group(
                            flags = ["%{libraries_to_link.name}"],
                            expand_if_equal = variable_with_value(
                                name = "libraries_to_link.type",
                                value = "object_file",
                            ),
                        ),
                        flag_group(
                            flags = ["%{libraries_to_link.name}"],
                            expand_if_equal = variable_with_value(
                                name = "libraries_to_link.type",
                                value = "interface_library",
                            ),
                        ),
                        flag_group(
                            flags = ["%{libraries_to_link.name}"],
                            expand_if_equal = variable_with_value(
                                name = "libraries_to_link.type",
                                value = "static_library",
                            ),
                        ),
                        flag_group(
                            flags = ["-l%{libraries_to_link.name}"],
                            expand_if_equal = variable_with_value(
                                name = "libraries_to_link.type",
                                value = "dynamic_library",
                            ),
                        ),
                        flag_group(
                            flags = ["-l:%{libraries_to_link.name}"],
                            expand_if_equal = variable_with_value(
                                name = "libraries_to_link.type",
                                value = "versioned_dynamic_library",
                            ),
                        ),
                        flag_group(
                            flags = ["-Wl,-no-whole-archive"],
                            expand_if_true = "libraries_to_link.is_whole_archive",
                        ),
                        flag_group(
                            flags = ["-Wl,--end-lib"],
                            expand_if_equal = variable_with_value(
                                name = "libraries_to_link.type",
                                value = "object_file_group",
                            ),
                        ),
                    ],
                    expand_if_available = "libraries_to_link",
                ),
            ],
        ),

        # Configure the header parsing and preprocessing.
        flag_set(
            actions = [ACTION_NAMES.cpp_header_parsing],
            flags = ["-xc++-header", "-fsyntax-only"],
            features = ["parse_headers"],
        ),

        # Note: user compile flags should be nearly last -- you probably
        # don't want to put any more features after this!
        flag_set(
            actions = [
                ACTION_NAMES.c_compile,
                ACTION_NAMES.cpp_compile,
                ACTION_NAMES.linkstamp_compile,
                ACTION_NAMES.assemble,
                ACTION_NAMES.preprocess_assemble,
                ACTION_NAMES.cpp_header_parsing,
                ACTION_NAMES.cpp_module_compile,
                ACTION_NAMES.cpp_module_codegen,
                ACTION_NAMES.clif_match,
            ],
            flag_groups = [
                flag_group(
                    flags = ["%{user_compile_flags}"],
                    iterate_over = "user_compile_flags",
                    expand_if_available = "user_compile_flags",
                ),
            ],
        ),
        flag_set(
            actions = all_link_actions,
            flag_groups = [
                flag_group(
                    flags = ["%{user_link_flags}"],
                    iterate_over = "user_link_flags",
                    expand_if_available = "user_link_flags",
                ),
            ],
        ),
        ## Options which need to go late -- after all the user options -- go here.
        flag_set(
            # One might hope that these options would only be needed for C++
            # compiles. But, sadly, users compile ".c" files with custom
            # copts=["-x", "c++"], and expect that to be able to find C++ stdlib
            # headers. It might be worth pondering how blaze could support this sort
            # of use-case better.
            actions = preprocessor_compile_actions +
                      [ACTION_NAMES.cc_flags_make_variable],
            flags = [
                "-iwithsysroot" + "/include/c++/v1",
                "-iwithsysroot" + "/include/compat",
                "-iwithsysroot" + "/include",
                "-isystem",
                emscripten_dir + "/lib/clang/21/include",
            ],
        ),
        # Inputs and outputs
        flag_set(
            actions = [
                ACTION_NAMES.c_compile,
                ACTION_NAMES.cpp_compile,
                ACTION_NAMES.linkstamp_compile,
                ACTION_NAMES.assemble,
                ACTION_NAMES.preprocess_assemble,
                ACTION_NAMES.cpp_header_parsing,
                ACTION_NAMES.cpp_module_compile,
                ACTION_NAMES.cpp_module_codegen,
                ACTION_NAMES.clif_match,
            ],
            flag_groups = [
                flag_group(
                    flags = ["-MD", "-MF", "%{dependency_file}"],
                    expand_if_available = "dependency_file",
                ),
            ],
        ),
        flag_set(
            actions = [
                ACTION_NAMES.c_compile,
                ACTION_NAMES.cpp_compile,
                ACTION_NAMES.linkstamp_compile,
                ACTION_NAMES.assemble,
                ACTION_NAMES.preprocess_assemble,
                ACTION_NAMES.cpp_header_parsing,
                ACTION_NAMES.cpp_module_compile,
                ACTION_NAMES.cpp_module_codegen,
                ACTION_NAMES.clif_match,
            ],
            flag_groups = [
                flag_group(
                    flags = ["-c", "%{source_file}"],
                    expand_if_available = "source_file",
                ),
            ],
        ),
        flag_set(
            actions = [
                ACTION_NAMES.c_compile,
                ACTION_NAMES.cpp_compile,
                ACTION_NAMES.linkstamp_compile,
                ACTION_NAMES.assemble,
                ACTION_NAMES.preprocess_assemble,
                ACTION_NAMES.cpp_header_parsing,
                ACTION_NAMES.cpp_module_compile,
                ACTION_NAMES.cpp_module_codegen,
                ACTION_NAMES.clif_match,
            ],
            flag_groups = [
                flag_group(
                    flags = ["-S"],
                    expand_if_available = "output_assembly_file",
                ),
                flag_group(
                    flags = ["-E"],
                    expand_if_available = "output_preprocess_file",
                ),
                flag_group(
                    flags = ["-o", "%{output_file}"],
                    expand_if_available = "output_file",
                ),
            ],
        ),
        flag_set(
            actions = all_link_actions,
            flag_groups = [
                flag_group(
                    flags = ["-o", "%{output_execpath}"],
                    expand_if_available = "output_execpath",
                ),
            ],
        ),
        # And finally, the params file!
        flag_set(
            actions = all_link_actions,
            flag_groups = [
                flag_group(
                    flags = ["@%{linker_param_file}"],
                    expand_if_available = "linker_param_file",
                ),
            ],
        ),
        flag_set(
            actions = all_compile_actions,
            flags = [
                "-Wno-builtin-macro-redefined",
                # Genrules may not escape quotes enough for these, so
                # don't put them into $(CC_FLAGS):
                '-D__DATE__="redacted"',
                '-D__TIMESTAMP__="redacted"',
                '-D__TIME__="redacted"',
            ],
        ),
        flag_set(
            actions = all_compile_actions,
            flags = ["-Werror"],
            features = ["wasm_warnings_as_errors"],
        ),
        flag_set(
            actions = all_link_actions,
            flags = ["-sSTANDALONE_WASM"],
            features = ["wasm_standalone"],
        ),
    ]

    crosstool_default_env_sets = [
        # Globals
        env_set(
            actions = all_compile_actions +
                      all_link_actions +
                      [ACTION_NAMES.cpp_link_static_library],
            env_entries = [
                env_entry(
                    key = "EM_BIN_PATH",
                    value = emscripten_dir,
                ),
                env_entry(
                    key = "EM_CONFIG_PATH",
                    value = ctx.file.em_config.path,
                ),
                env_entry(
                    key = "NODE_JS_PATH",
                    value = nodejs_path,
                ),
            ],
        ),
        # Use llvm backend.  Off by default, enabled via --features=llvm_backend
        env_set(
            actions = all_compile_actions +
                      all_link_actions +
                      [ACTION_NAMES.cpp_link_static_library],
            env_entries = [env_entry(key = "EMCC_WASM_BACKEND", value = "1")],
            with_features = [with_feature_set(features = ["llvm_backend"])],
        ),
        # Debug compile and link. Off by default, enabled via --features=emcc_debug
        env_set(
            actions = all_compile_actions,
            env_entries = [env_entry(key = "EMCC_DEBUG", value = "1")],
            with_features = [with_feature_set(features = ["emcc_debug"])],
        ),

        # Debug only link step. Off by default, enabled via --features=emcc_debug_link
        env_set(
            actions = all_link_actions,
            env_entries = [env_entry(key = "EMCC_DEBUG", value = "1")],
            with_features = [
                with_feature_set(features = ["emcc_debug"]),
                with_feature_set(features = ["emcc_debug_link"]),
            ],
        ),
    ]

    crosstool_default_flags_feature = feature(
        name = "crosstool_default_flags",
        enabled = True,
        flag_sets = crosstool_default_flag_sets,
        env_sets = crosstool_default_env_sets,
    )

    features.append(crosstool_default_flags_feature)

    cxx_builtin_include_directories = [
        emscripten_dir + "/emscripten/cache/sysroot/include/c++/v1",
        emscripten_dir + "/emscripten/cache/sysroot/include/compat",
        emscripten_dir + "/emscripten/cache/sysroot/include",
        emscripten_dir + "/lib/clang/21/include",
    ]

    artifact_name_patterns = []

    make_variables = []

    return cc_common.create_cc_toolchain_config_info(
        ctx = ctx,
        features = features,
        action_configs = action_configs,
        artifact_name_patterns = artifact_name_patterns,
        cxx_builtin_include_directories = cxx_builtin_include_directories,
        toolchain_identifier = toolchain_identifier,
        host_system_name = host_system_name,
        target_system_name = target_system_name,
        target_cpu = target_cpu,
        target_libc = target_libc,
        compiler = compiler,
        abi_version = abi_version,
        abi_libc_version = abi_libc_version,
        tool_paths = tool_paths,
        make_variables = make_variables,
        builtin_sysroot = builtin_sysroot,
        cc_target_os = cc_target_os,
    )

emscripten_cc_toolchain_config_rule = rule(
    implementation = _impl,
    attrs = {
        "cpu": attr.string(mandatory = True, values = ["asmjs", "wasm"]),
        "em_config": attr.label(mandatory = True, allow_single_file = True),
        "emscripten_binaries": attr.label(mandatory = True, cfg = "exec"),
        "nodejs_bin": attr.label(mandatory = True, allow_single_file = True),
        "script_extension": attr.string(mandatory = True, values = ["sh", "bat"]),
    },
    provides = [CcToolchainConfigInfo],
)
