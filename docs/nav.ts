export type Nav = {
  items: NavItem[];
};

export type NavItem = NavPage | NavDivider;
export type NavPage = {
  type: "page";
  slug: string;
  title: string;
  disabled?: boolean;
  href?: string;
};
type NavDivider = {
  type: "divider";
  title: string;
};

function page(slug: string, title: string, props: { disabled?: boolean; href?: string; description: string }): NavPage {
  return { type: "page", slug, title, ...props };
}
function divider(title: string): NavDivider {
  return { type: "divider", title };
}

export default {
  items: [
    divider("Intro"),
    page("index", "What is Bun?", {
      description:
        "Bun is an all-in-one runtime for JavaScript and TypeScript apps. Run, bundle, and test apps with one fast tool.",
    }),
    page("installation", "Installation", {
      description: "Install Bun with npm, Homebrew, Docker, or the official install script.",
    }),
    page("quickstart", "Quickstart", {
      description: "Get started with Bun by building and running a simple HTTP server in 6 lines of TypeScript.",
    }),
    page("typescript", "TypeScript", {
      description: "Install and configure type declarations for Bun's APIs",
    }),

    divider("Templating"),
    page("cli/init", "`bun init`", {
      description: "Scaffold an empty Bun project.",
    }),
    page("cli/bun-create", "`bun create`", {
      description: "Scaffold a new Bun project from an official template or GitHub repo.",
    }),

    // page("typescript", "TypeScript"),

    // divider("CLI"),
    // page("cli/run", "`bun run`", {
    //   description:
    //     "Use `bun run` to execute JavaScript/TypeScript files, package.json scripts, and executable packages.",
    // }),
    // page("cli/install", "`bun install`", {
    //   description: "A 100x faster npm client with workspaces, git dependencies, and private registry support.",
    // }),
    // page("cli/test", "`bun test`", {
    //   description: "Bun's test runner uses Jest-compatible syntax but runs 100x faster.",
    // }),
    // page("cli/create", "`bun create`", {
    //   description: "Scaffold a new Bun project from an official template or GitHub repo.",
    // }),
    // page("cli/bunx", "`bunx`", {
    //   description:
    //     "Use `bunx` to auto-install and run executable packages from npm, or use locally installed command-line tools.",
    // }),
    // page("cli/deploy", "`bun deploy`", {
    //   disabled: true,
    //   description: "Deploy your Bun app to the cloud (eventually)",
    // }),

    // page("bundler", "Bundler"),
    // page("cli/bun-install", "`bun install`"),
    // page("cli/bun-create", "`bun create`"),
    // page("cli/bun-upgrade", "`bun upgrade`"),
    // page("cli/bun-bun", "`bun bun`"),
    // page("cli/bun-init", "`bun init`"),
    // page("cli/bun-completions", "`bun completions`"),
    // page("bundev", "Dev server"),
    // page("benchmarks", "Benchmarks"),

    divider("Runtime"),
    page("cli/run", "`bun run`", {
      description: "Use `bun run` to execute JavaScript/TypeScript files and package.json scripts.",
    }),
    // page("runtime/index", "Overview", {
    //   description: `Bun is a new JavaScript runtime designed to be a faster, leaner, more modern replacement for Node.js.`,
    // }),
    // page("runtime/performance", "Performance", {
    //   description: `Bun is a new JavaScript runtime designed to be a faster, leaner, more modern replacement for Node.js.`,
    // }),
    page("runtime/loaders", "File types", {
      description: `Bun's runtime supports JavaScript/TypeScript files, JSX syntax, Wasm, JSON/TOML imports, and more.`,
    }),
    page("runtime/typescript", "TypeScript", {
      description: `Bun can directly execute TypeScript files without additional configuration.`,
    }),
    page("runtime/jsx", "JSX", {
      description: `Bun can directly execute TypeScript files without additional configuration.`,
    }),
    // page("runtime/apis", "APIs", {
    //   description: `Bun is a new JavaScript runtime designed to be a faster, leaner, more modern replacement for Node.js.`,
    // }),
    page("runtime/env", "Environment variables", {
      description: `How to read and set environment variables, plus how to use them to configure Bun`,
    }),
    page("runtime/bun-apis", "Bun APIs", {
      description: `Bun provides a set of highly optimized native APIs for performing common tasks.`,
    }),
    page("runtime/web-apis", "Web APIs", {
      description: `Bun implements an array of Web-standard APIs like fetch, URL, and WebSocket.`,
    }),
    page("runtime/nodejs-apis", "Node.js compatibility", {
      description: `Bun aims for full Node.js compatibility. This page tracks the current compatibility status.`,
    }),
    page("bundler/executables", "Single-file executable", {
      description: "Compile a TypeScript or JavaScript file to a standalone executable",
    }),
    page("runtime/plugins", "Plugins", {
      description: `Implement custom loaders and module resolution logic with Bun's plugin system.`,
    }),

    // page("runtime/nodejs", "Node.js compatibility", {
    //   description: `Track the status of Bun's API compatibility with Node.js.`,
    // }),
    // page("runtime/web-apis", "Web APIs"),
    // page("runtime/loaders", "Loaders"),

    page("runtime/hot", "Watch mode", {
      description: `Reload your application & tests automatically.`,
    }),
    page("runtime/modules", "Module resolution", {
      description: `Bun uses ESM and implements an extended version of the Node.js module resolution algorithm.`,
    }),
    page("runtime/autoimport", "Auto-install", {
      description: `Never use node_modules again. Bun can optionally auto-install your dependencies on the fly.`,
    }),
    page("runtime/bunfig", "bunfig.toml", {
      description: `Bun's runtime is configurable with environment variables and the bunfig.toml config file.`,
    }),
    page("runtime/debugger", "Debugger", {
      description: `Debug your code with Bun's web-based debugger or VS Code extension`,
    }),
    page("runtime/framework", "Framework API", {
      disabled: true,
      description:
        "Coming soon. Use the Framework API to build a fast, cloud-ready framework on top of Bun's bundler and runtime.",
    }),

    divider("Package manager"),
    page("cli/install", "`bun install`", {
      description:
        "Install all dependencies with `bun install`, or manage dependencies with `bun add` and `bun remove`.",
    }),
    page("cli/add", "`bun add`", {
      description: "Add dependencies to your project.",
    }),
    page("cli/remove", "`bun remove`", {
      description: "Remove dependencies from your project.",
    }),
    page("cli/update", "`bun update`", {
      description: "Update your project's dependencies.",
    }),
    page("cli/outdated", "`bun outdated`", {
      description: "Check for outdated dependencies.",
    }),
    page("cli/link", "`bun link`", {
      description: "Install local packages as dependencies in your project.",
    }),
    page("cli/pm", "`bun pm`", {
      description: "Utilities relating to package management with Bun.",
    }),
    page("install/cache", "Global cache", {
      description:
        "Bun's package manager installs all packages into a shared global cache to avoid redundant re-downloads.",
    }),
    page("install/workspaces", "Workspaces", {
      description: "Bun's package manager supports workspaces and mono-repo development workflows.",
    }),
    page("install/lifecycle", "Lifecycle scripts", {
      description: "How Bun handles package lifecycle scripts with trustedDependencies",
    }),
    page("cli/filter", "Filter", {
      description: "Run scripts in multiple packages in parallel",
    }),
    page("install/lockfile", "Lockfile", {
      description:
        "Bun's binary lockfile `bun.lockb` tracks your resolved dependency tree, making future installs fast and repeatable.",
    }),
    page("install/registries", "Scopes and registries", {
      description: "How to configure private scopes and custom package registries.",
    }),
    page("install/overrides", "Overrides and resolutions", {
      description: "Specify version ranges for nested dependencies",
    }),
    page("install/patch", "Patch dependencies", {
      description:
        "Patch dependencies in your project to fix bugs or add features without vendoring the entire package.",
    }),
    page("install/npmrc", ".npmrc support", {
      description: "Bun supports loading some configuration options from .npmrc",
    }),
    // page("install/utilities", "Utilities", {
    //   description: "Use `bun pm` to introspect your global module cache or project dependency tree.",
    // }),

    divider("Bundler"),
    page("bundler", "`Bun.build`", {
      description: "Bundle code for consumption in the browser with Bun's native bundler.",
    }),
    // page("bundler/intro", "How bundlers work", {
    //   description: "A visual introduction to bundling",
    // }),
    page("bundler/loaders", "Loaders", {
      description: "Bun's built-in loaders for the bundler and runtime",
    }),
    page("bundler/plugins", "Plugins", {
      description: `Implement custom loaders and module resolution logic with Bun's plugin system.`,
    }),
    page("bundler/macros", "Macros", {
      description: `Run JavaScript functions at bundle-time and inline the results into your bundle`,
    }),
    page("bundler/vs-esbuild", "vs esbuild", {
      description: `Guides for migrating from other bundlers to Bun.`,
    }),

    divider("Test runner"),
    page("cli/test", "`bun test`", {
      description: "Bun's test runner uses Jest-compatible syntax but runs 100x faster.",
    }),
    page("test/writing", "Writing tests", {
      description:
        "Write your tests using Jest-like expect matchers, plus setup/teardown hooks, snapshot testing, and more",
    }),
    page("test/hot", "Watch mode", {
      description: "Reload your tests automatically on change.",
    }),
    page("test/lifecycle", "Lifecycle hooks", {
      description: "Add lifecycle hooks to your tests that run before/after each test or test run",
    }),
    page("test/mocks", "Mocks", {
      description: "Mocks functions and track method calls",
    }),
    page("test/snapshots", "Snapshots", {
      description: "Add lifecycle hooks to your tests that run before/after each test or test run",
    }),
    page("test/time", "Dates and times", {
      description: "Control the date & time in your tests for more reliable and deterministic tests",
    }),
    page("test/dom", "DOM testing", {
      description: "Write headless tests for UI and React/Vue/Svelte/Lit components with happy-dom",
    }),
    page("test/coverage", "Code coverage", {
      description: "Generate code coverage reports with `bun test --coverage`",
    }),

    divider("Package runner"),
    page("cli/bunx", "`bunx`", {
      description: "Use `bunx` to auto-install and run executable packages from npm.",
    }),

    // page("runtime/nodejs", "Node.js APIs"),

    // divider("Ecosystem"),
    // page("ecosystem/react", "React", {
    //   description: `The Bun runtime supports JSX syntax out of the box and optimizes server-side rendering.`,
    // }),
    // page("ecosystem/express", "Express", {
    //   description: `Servers built with Express and other major Node.js HTTP libraries work out of the box.`,
    // }),
    // page("ecosystem/elysia", "Elysia", {
    //   description: `Get started with Elysia, a Bun-native framework designed for the edge.`,
    // }),
    // page("ecosystem/hono", "Hono", {
    //   description: `Hono is an ultra-fast, Bun-friendly web framework designed for edge environments.`,
    // }),
    // page("ecosystem/buchta", "Buchta", {
    //   description: `Buchta is a Bun-native fullstack framework for Svelte and Preact apps.`,
    // }),
    // page("ecosystem/stric", "Stric", {
    //   description: `Stric is a minimalist, fast web framework for Bun.`,
    // }),
    // page("ecosystem/awesome", "Awesome", {
    //   href: "https://github.com/apvarun/awesome-bun",
    //   description: ``,
    // }),

    divider("API"),
    page("api/http", "HTTP server", {
      description: `Bun implements a fast HTTP server built on Request/Response objects, along with supporting node:http APIs.`,
    }), // "`Bun.serve`"),
    page("api/fetch", "HTTP client", {
      description: `Bun implements Web-standard fetch with some Bun-native extensions.`,
    }), // "fetch"),
    page("api/websockets", "WebSockets", {
      description: `Bun supports server-side WebSockets with on-the-fly compression, TLS support, and a Bun-native pubsub API.`,
    }), // "`Bun.serve`"),
    page("api/workers", "Workers", {
      description: `Run code in a separate thread with Bun's native Worker API.`,
    }), // "`Worker`"),
    page("api/binary-data", "Binary data", {
      description: `How to represent and manipulate binary data in Bun.`,
    }), // "`Bun.serve`"),
    page("api/streams", "Streams", {
      description: `Reading, writing, and manipulating streams of data in Bun.`,
    }), // "`Bun.serve`"),
    page("api/file-io", "File I/O", {
      description: `Read and write files fast with Bun's heavily optimized file system API.`,
    }), // "`Bun.write`"),
    page("api/import-meta", "import.meta", {
      description: `Module-scoped metadata and utilities`,
    }), // "`bun:sqlite`"),
    page("api/sqlite", "SQLite", {
      description: `The fastest SQLite driver for JavaScript is baked directly into Bun.`,
    }), // "`bun:sqlite`"),
    page("api/file-system-router", "FileSystemRouter", {
      description: `Resolve incoming HTTP requests against a local file system directory with Bun's fast, Next.js-compatible router.`,
    }), // "`Bun.FileSystemRouter`"),
    page("api/tcp", "TCP sockets", {
      description: `Bun's native API implements Web-standard TCP Sockets, plus a Bun-native API for building fast TCP servers.`,
    }), // "`Bun.{listen|connect}`")
    page("api/udp", "UDP sockets", {
      description: `Bun's native API implements fast and flexible UDP sockets.`,
    }), // "`Bun.udpSocket`")
    page("api/globals", "Globals", {
      description: `Bun implements a range of Web APIs, Node.js APIs, and Bun-native APIs that are available in the global scope.`,
    }), // "`Bun.write`"),
    page("runtime/shell", "$ Shell", {
      description: `Bun's cross-platform shell-scripting API makes shell scripting with JavaScript fun`,
    }), // "`Bun.$`"),
    page("api/spawn", "Child processes", {
      description: `Spawn sync and async child processes with easily configurable input and output streams.`,
    }), // "`Bun.spawn`"),
    page("api/transpiler", "Transpiler", {
      description: `Bun exposes its internal transpiler as a pluggable API.`,
    }), // "`Bun.Transpiler`"),
    page("api/hashing", "Hashing", {
      description: `Native support for a range of fast hashing algorithms.`,
    }), // "`Bun.serve`"),
    page("api/console", "Console", {
      description: `Bun implements a Node.js-compatible \`console\` object with colorized output and deep pretty-printing.`,
    }), // "`Node-API`"),
    page("api/ffi", "FFI", {
      description: `Call native code from JavaScript with Bun's foreign function interface (FFI) API.`,
    }), // "`bun:ffi`"),
    page("api/html-rewriter", "HTMLRewriter", {
      description: `Parse and transform HTML with Bun's native HTMLRewriter API, inspired by Cloudflare Workers.`,
    }), // "`HTMLRewriter`"),
    page("api/test", "Testing", {
      description: `Bun's built-in test runner is fast and uses Jest-compatible syntax.`,
    }), // "`bun:test`"),
    page("api/utils", "Utils", {
      description: `Bun implements a set of utilities that are commonly required by developers.`,
    }), // "`Bun.peek`"),
    page("api/node-api", "Node-API", {
      description: `Bun implements the Node-API spec for building native addons.`,
    }), // "`Node-API`"),

    page("api/glob", "Glob", {
      description: `Bun includes a fast native Glob implementation for matching file paths.`,
    }), // "`Glob`"),

    page("api/dns", "DNS", {
      description: `Resolve domain names to IP addresses.`,
    }), // "`bun:dns`"),

    page("api/semver", "Semver", {
      description: `Bun's native Semver implementation is 20x faster than the popular \`node-semver\` package.`,
    }), // "`Semver`"),

    // divider("Dev Server"),
    // page("bun-dev", "Vanilla"),
    // page("dev/css", "CSS"),
    // page("dev/frameworks", "Frameworks"),
    // page("dev/nextjs", "Next.js"),
    // page("dev/cra", "Create React App"),

    divider("Project"),
    page("project/roadmap", "Roadmap", {
      description: `Track Bun's near-term and long-term goals.`,
    }),

    page("project/benchmarking", "Benchmarking", {
      description: `Bun is designed for performance. Learn how to benchmark Bun yourself.`,
    }),
    page("project/contributing", "Contributing", {
      description: "Learn how to contribute to Bun and get your local development environment up and running.",
    }),
    page("project/building-windows", "Building Windows", {
      description: "Learn how to setup a development environment for contributing to the Windows build of Bun.",
    }),
    page("project/licensing", "License", {
      description: `Bun is a MIT-licensed project with a large number of statically-linked dependencies with various licenses.`,
    }),

    // misc
    // page("roadmap", "Roadmap"),
    // page("troubleshooting", "Troubleshooting"),
    // page("bunfig", "bunfig.toml"),
    // page("upgrading-webkit", "Upgrading WebKit"),
    // page("bun-flavored-toml", "Bun-flavored TOML"),
  ],
} satisfies Nav;
