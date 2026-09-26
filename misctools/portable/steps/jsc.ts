/**
 * The image of JavaScriptCore's "jsc" shell, linked against the sysroot.
 *
 *   mimalloc   bun's mimalloc as one object, with bun's flags for a release build
 *   webkit     WebKit's libJavaScriptCore.a, libWTF.a, libbmalloc.a and the two objects of the shell,
 *              compiled with the flags of the image and with bun's options for WebKit
 *   link       <out>/jsc.img, <out>/jsc.img.map (the link map of lld), <out>/jsc.img.json (what it is)
 *
 * WebKit's own link of the shell is not run: it would take the mimalloc that WebKit brings along. The image
 * links the one that bun links.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MEMORY_FUNCTIONS,
  REPOSITORY,
  TREE,
  compileFlags,
  cpuFlags,
  cxxIncludeFlags,
  driverLinkFlags,
  driverRuntimeFlags,
  hostArch,
} from "../flags.ts";
import { type Context, type Step, inOut, logOf, runStep } from "./context.ts";
import { BuildError, type GitSource, fetchGit, run, sha256File } from "./run.ts";
import { cmakeToolchain } from "./sysroot.ts";

/**
 * mi_new, mi_new_n and mi_mallocn hand the default heap of the thread to mi_theap_malloc, which does not
 * take the NULL that a thread has there before its first allocation in the pthreads model.
 */
const MIMALLOC_PATCH = join(TREE, "patches", "mimalloc-theap-null-in-new.diff");

/** What of oven-sh/WebKit the build of JavaScriptCore reads. */
const WEBKIT_DIRECTORIES = [
  ".github/scripts",
  "Source/JavaScriptCore",
  "Source/ThirdParty/gtest",
  "Source/ThirdParty/unifdef",
  "Source/WTF",
  "Source/bmalloc",
  "Source/cmake",
  "Tools/Scripts",
  "Tools/TestWebKitAPI",
  "icu",
];

const WEBKIT_LIBRARIES = ["libJavaScriptCore.a", "libWTF.a", "libbmalloc.a"];
const SHELL_OBJECTS = ["jsc.cpp.o", "tools/JSDollarVMShell.cpp.o"].map(name =>
  join("Source", "JavaScriptCore", "shell", "CMakeFiles", "jsc.dir", "__", name),
);

/** Functions that bun defines and JavaScriptCore calls. The shell has them as symbols that stay undefined. */
const UNDEFINED_IN_THE_SHELL = [
  "_Bun__reportUnhandledError",
  "_Bun__thisThreadHasVM",
  "_WTFTimer__cancel",
  "_WTFTimer__secondsUntilTimer",
  "_WTFTimer__isActive",
  "_WTFTimer__deinit",
  "_WTFTimer__update",
  "_WTFTimer__create",
];

const tool = (ctx: Context, name: string) => join(ctx.llvm, name);

/**
 * bun pins WebKit and mimalloc in its build scripts, and an image links what bun links. The text of the
 * file is read. The scripts are not run: they are parts of bun's build and import each other in a circle
 * that only its entry point enters at the right place.
 */
function pinnedBy(file: string, pattern: RegExp): string {
  const path = join(REPOSITORY, "scripts", "build", "deps", file);
  if (!existsSync(path)) throw new BuildError(`${path} is not there: build.ts has to run from bun's repository`);
  const commit = pattern.exec(readFileSync(path, "utf8"))?.[1];
  if (commit === undefined) throw new BuildError(`${path}: no pinned commit`, { hint: `looked for ${pattern}` });
  return commit;
}

const webkitCommit = () => pinnedBy("webkit.ts", /^export const WEBKIT_VERSION = "([0-9a-f]{40})";$/m);
const mimallocCommit = () => pinnedBy("mimalloc.ts", /^const MIMALLOC_COMMIT = "([0-9a-f]{40})";$/m);

/** `default` or `pthreads`: where mimalloc keeps the heap of a thread. */
function tlsModel(): string {
  const model = process.env.MIMALLOC_TLS ?? "default";
  if (model !== "default" && model !== "pthreads") throw new BuildError(`MIMALLOC_TLS=${model}: default or pthreads`);
  return model;
}

// ───────────────────────────────────────────────────────────────────────────
// mimalloc
// ───────────────────────────────────────────────────────────────────────────

function mimallocObject(ctx: Context): string {
  return inOut(ctx, "build", `mimalloc-${tlsModel()}`, "mimalloc.o");
}

function mimalloc(ctx: Context, before: string): Step {
  const source: GitSource = {
    url: "https://github.com/oven-sh/mimalloc",
    urlVariable: "MIMALLOC_GIT",
    commit: mimallocCommit(),
  };
  // bun's flags for mimalloc in a release build (scripts/build/flags.ts, scripts/build/deps/mimalloc.ts).
  // The thread id is pthread_self() in both models: what mimalloc does by itself with musl is inline
  // assembly that reads fs.
  const flags = [
    "-x",
    "c++",
    "-std=c++20",
    ...compileFlags(ctx.arch, ctx.sysroot),
    ...cxxIncludeFlags(ctx.sysroot),
    "-stdlib=libc++",
    "-O3",
    "-DNDEBUG",
    ...cpuFlags(ctx.arch),
    "-fno-exceptions",
    "-fno-rtti",
    "-fno-c++-static-destructors",
    "-fno-omit-frame-pointer",
    "-mno-omit-leaf-frame-pointer",
    "-fvisibility=hidden",
    "-fvisibility-inlines-hidden",
    "-fno-unwind-tables",
    "-fno-asynchronous-unwind-tables",
    "-ffunction-sections",
    "-fdata-sections",
    "-faddrsig",
    "-fno-semantic-interposition",
    "-DMI_STATIC_LIB",
    "-DMI_SKIP_COLLECT_ON_EXIT=1",
    "-DMI_NO_PROCESS_DETACH=1",
    "-DMI_FREE_USE_PAGEMAP=1",
    "-DMI_BUILD_RELEASE",
    "-DMI_DEFAULT_ALLOW_THP=0",
    "-DMI_MALLOC_OVERRIDE",
    "-DMI_CMAKE_BUILD_TYPE=release",
    "-DMI_LIBC_MUSL=1",
    "-Wno-deprecated",
    "-Wno-static-in-inline",
    "-fno-builtin-malloc",
    "-ftls-model=local-dynamic",
    "-DMI_PRIM_THREAD_ID=pthread_self",
    ...(tlsModel() === "pthreads" ? ["-DMI_TLS_MODEL_PTHREADS=1"] : []),
  ];
  const object = mimallocObject(ctx);
  return {
    name: `mimalloc-${tlsModel()}`,
    inputs: [before, source.commit, sha256File(MIMALLOC_PATCH), flags],
    outputs: [object],
    make() {
      const dir = inOut(ctx, "src", "mimalloc");
      fetchGit("mimalloc", source, dir, [MIMALLOC_PATCH], inOut(ctx, "logs"));
      mkdirSync(join(object, ".."), { recursive: true });
      run(
        [tool(ctx, "clang++"), ...flags, `-I${join(dir, "include")}`, "-c", join(dir, "src", "static.c"), "-o", object],
        {
          log: logOf(ctx, "mimalloc"),
        },
      );
      writeFileSync(join(object, "..", "FLAGS.txt"), flags.join(" ") + "\n");
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// WebKit
// ───────────────────────────────────────────────────────────────────────────

/** The checkout that is compiled, and the commit it is at. $BUN_WEBKIT_PATH is read and never written. */
export function webkitSource(ctx: Context): { dir: string; commit: string; fetch: () => void } {
  const given = process.env.BUN_WEBKIT_PATH;
  if (given !== undefined && given !== "") {
    if (!existsSync(join(given, "Source", "JavaScriptCore"))) {
      throw new BuildError(`BUN_WEBKIT_PATH=${given}: no checkout of WebKit (Source/JavaScriptCore is not there)`);
    }
    const head = existsSync(join(given, ".git")) ? run(["git", "-C", given, "rev-parse", "HEAD"]).trim() : given;
    if (head !== webkitCommit()) {
      console.log(`[webkit] ${given} is at ${head}, bun is pinned to ${webkitCommit()}: compiling what is there`);
    }
    return { dir: given, commit: head, fetch: () => {} };
  }
  const dir = inOut(ctx, "src", "WebKit");
  const source: GitSource = {
    url: "https://github.com/oven-sh/WebKit",
    urlVariable: "WEBKIT_GIT",
    commit: webkitCommit(),
    sparse: WEBKIT_DIRECTORIES,
  };
  return { dir, commit: source.commit, fetch: () => void fetchGit("webkit", source, dir, [], inOut(ctx, "logs")) };
}

function webkit(ctx: Context, before: string): Step {
  const source = webkitSource(ctx);
  const image = [...compileFlags(ctx.arch, ctx.sysroot), ...cpuFlags(ctx.arch)].join(" ");
  // bun's options for a WebKit that it builds itself (scripts/build/deps/webkit.ts), release, no LTO.
  const options = [
    "-G",
    "Ninja",
    "-DPORT=JSCOnly",
    "-DCMAKE_BUILD_TYPE=Release",
    "-DENABLE_STATIC_JSC=ON",
    "-DUSE_THIN_ARCHIVES=OFF",
    "-DENABLE_FTL_JIT=ON",
    "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
    "-DUSE_BUN_JSC_ADDITIONS=ON",
    "-DUSE_BUN_EVENT_LOOP=ON",
    "-DUSE_MIMALLOC=ON",
    "-DUSE_EXTERNAL_MIMALLOC=ON",
    "-DENABLE_BUN_SKIP_FAILING_ASSERTIONS=ON",
    "-DALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS=ON",
    "-DENABLE_REMOTE_INSPECTOR=ON",
    "-DENABLE_MEDIA_SOURCE=OFF",
    "-DENABLE_MEDIA_STREAM=OFF",
    "-DENABLE_WEB_RTC=OFF",
    `-DCMAKE_C_COMPILER=${tool(ctx, "clang")}`,
    `-DCMAKE_CXX_COMPILER=${tool(ctx, "clang++")}`,
    `-DCMAKE_AR=${tool(ctx, "llvm-ar")}`,
    `-DCMAKE_RANLIB=${tool(ctx, "llvm-ranlib")}`,
    `-DCMAKE_C_FLAGS=${image}`,
    `-DCMAKE_CXX_FLAGS=${[image, ...cxxIncludeFlags(ctx.sysroot), "-stdlib=libc++"].join(" ")}`,
    `-DCMAKE_EXE_LINKER_FLAGS=${driverRuntimeFlags().join(" ")}`,
    `-DICU_ROOT=${join(ctx.sysroot.root, "usr")}`,
    // An image of this machine's architecture runs here, so cmake may run what it compiles to find
    // things out. For another architecture it is told that it cannot.
    ...(ctx.arch === hostArch() ? [] : cmakeToolchain(ctx).filter(option => option.startsWith("-DCMAKE_SYSTEM_"))),
  ];
  const build = inOut(ctx, "build", "webkit");
  return {
    name: "webkit",
    inputs: [before, source.commit, source.dir, options],
    outputs: [
      ...WEBKIT_LIBRARIES.map(name => join(build, "lib", name)),
      ...SHELL_OBJECTS.map(name => join(build, name)),
    ],
    make() {
      source.fetch();
      rmSync(build, { recursive: true, force: true });
      // The generators of WebKit are Python scripts in the checkout. Python must not leave its caches there.
      const env = { PYTHONDONTWRITEBYTECODE: "1" };
      run(["cmake", "-S", source.dir, "-B", build, ...options], { env, log: logOf(ctx, "webkit-configure") });
      run(
        ["ninja", "-C", build, `-j${ctx.jobs}`, ...WEBKIT_LIBRARIES.map(name => join("lib", name)), ...SHELL_OBJECTS],
        { env, log: logOf(ctx, "webkit-build") },
      );
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// The image
// ───────────────────────────────────────────────────────────────────────────

function link(ctx: Context, before: string): Step {
  const image = inOut(ctx, "jsc.img");
  const build = inOut(ctx, "build", "webkit");
  const library = (name: string) => join(build, "lib", name);
  const command = [
    tool(ctx, "clang++"),
    ...UNDEFINED_IN_THE_SHELL.map(symbol => `-Wl,-u,${symbol}`),
    ...compileFlags(ctx.arch, ctx.sysroot),
    ...cpuFlags(ctx.arch),
    ...cxxIncludeFlags(ctx.sysroot),
    "-stdlib=libc++",
    "-fno-strict-aliasing",
    "-fno-exceptions",
    "-fno-rtti",
    "-ffunction-sections",
    "-fdata-sections",
    "-O3",
    "-DNDEBUG",
    ...driverRuntimeFlags(),
    ...driverLinkFlags(),
    "-Xlinker",
    "--gc-sections",
    "-Xlinker",
    "--disable-new-dtags",
    ...SHELL_OBJECTS.map(name => join(build, name)),
    "-o",
    image,
    `-Wl,-Map=${image}.map`,
    ...MEMORY_FUNCTIONS.map(name => join(ctx.sysroot.memfn, `${name}.o`)),
    "-ldl",
    mimallocObject(ctx),
    library("libJavaScriptCore.a"),
    library("libWTF.a"),
    ...["libicudata.a", "libicui18n.a", "libicuuc.a"].map(name => join(ctx.sysroot.lib, name)),
    library("libbmalloc.a"),
    "-ldl",
  ];
  return {
    name: "jsc",
    inputs: [before, command],
    outputs: [image, `${image}.map`, `${image}.json`],
    make() {
      run(command, { log: logOf(ctx, "jsc-link") });
      const sizes = run([tool(ctx, "llvm-size"), "-A", image]);
      const map = readFileSync(`${image}.map`, "utf8").split("\n");
      /** The input section that a symbol of the image came from, as the link map names it. */
      const from = (symbol: string) => {
        const at = map.findIndex(line => line.endsWith(` ${symbol}`));
        for (let i = at; i > 0; i--) {
          if (/:\(\.[a-z]/.test(map[i]!)) return map[i]!.trim().split(/\s+/).slice(4).join(" ");
        }
        return "not found";
      };
      const facts = {
        path: image,
        sha256: sha256File(image),
        size: statSync(image).size,
        text_bytes: Number(/^\.text\s+(\d+)/m.exec(sizes)?.[1]),
        mimalloc_tls_model: tlsModel(),
        __emutls_get_address: from("__emutls_get_address"),
        __bun_libc_malloc_impl: from("__bun_libc_malloc_impl"),
        malloc: from("malloc"),
      };
      writeFileSync(`${image}.json`, JSON.stringify(facts, null, 1) + "\n");
      console.log(JSON.stringify(facts, null, 1));
    },
  };
}

/** `sysroot` is the identity of the sysroot that everything here is compiled and linked against. */
export async function buildJsc(ctx: Context, sysroot: string): Promise<void> {
  const allocator = await runStep(ctx, mimalloc(ctx, sysroot));
  const libraries = await runStep(ctx, webkit(ctx, sysroot));
  await runStep(ctx, link(ctx, `${allocator} ${libraries}`));
}
