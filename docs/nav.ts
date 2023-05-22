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
    page("templates", "Templates", {
      description: "Hit the ground running with one of Bun's official templates, or download a template from GitHub.",
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

    // divider("Runtime"),
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
    page("runtime/bun-apis", "Bun APIs", {
      description: `Bun provides a set of highly optimized native APIs for performing common tasks.`,
    }),
    page("runtime/web-apis", "Web APIs", {
      description: `Bun implements an array of Web-standard APIs like fetch, URL, and WebSocket.`,
    }),
    page("runtime/nodejs-apis", "Node.js compatibility", {
      description: `Bun aims for full Node.js compatibility. This page tracks the current compatibility status.`,
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
    page("runtime/configuration", "Configuration", {
      description: `Bun's runtime is configurable with environment variables and the bunfig.toml config file.`,
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
    page("install/workspaces", "Workspaces", {
      description: "Bun's package manager supports workspaces and mono-repo development workflows.",
    }),
    page("install/cache", "Global cache", {
      description:
        "Bun's package manager installs all packages into a shared global cache to avoid redundant re-downloads.",
    }),
    page("install/lockfile", "Lockfile", {
      description:
        "Bun's binary lockfile `bun.lockb` tracks your resolved dependency ytrr, making future installs fast and repeatable.",
    }),
    page("install/registries", "Scopes and registries", {
      description: "How to configure private scopes and custom package registries.",
    }),
    page("install/utilities", "Utilities", {
      description: "Use `bun pm` to introspect your global module cache or project dependency tree.",
    }),

    divider("Bundler"),
    page("bundler", "`Bun.build`", {
      description: "Bundle code for comsumption in the browser with Bun's native bundler.",
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
    page("bundler/executables", "Executables", {
      description: "Compile a TypeScript or JavaScript file to a standalone cross-platform executable",
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
    page("test/extending", "Extending the test runner", {
      description: "Add lifecycle hooks to your tests that run before/after each test, or before/after all tests.",
    }),
    page("test/hot", "Watch mode", {
      description: "Reload your tests automatically on change.",
    }),

    divider("Package runner"),
    page("cli/bunx", "`bunx`", {
      description: "Use `bunx` to auto-install and run executable packages from npm.",
    }),

    // page("runtime/nodejs", "Node.js APIs"),

    divider("Ecosystem"),
    // page("ecosystem/react", "React", {
    //   description: `The Bun runtime supports JSX syntax out of the box and optimizes server-side rendering.`,
    // }),
    page("ecosystem/express", "Express", {
      description: `Servers built with Express and other major Node.js HTTP libraries work out of the box.`,
    }),
    page("ecosystem/elysia", "Elysia", {
      description: `Get started with Elysia, a Bun-native framework designed for the edge.`,
    }),
    page("ecosystem/hono", "Hono", {
      description: `Hono is an ultra-fast, Bun-friendly web framework designed for edge environments.`,
    }),
    // page("ecosystem/buchta", "Buchta", {
    //   description: `Buchta is a Bun-native fullstack framework for Svelte and Preact apps.`,
    // }),
    page("ecosystem/stric", "Stric", {
      description: `Stric is a minimalist, fast web framework for Bun.`,
    }),

    page("ecosystem/awesome", "Awesome", {
      href: "https://github.com/apvarun/awesome-bun",
      description: ``,
    }),

    divider("API"),
    page("api/http", "HTTP", {
      description: `Bun implements Web-standard fetch, plus a Bun-native API for building fast HTTP servers.`,
    }), // "`Bun.serve`"),
    page("api/websockets", "WebSockets", {
      description: `Bun supports server-side WebSockets with on-the-fly compression, TLS support, and a Bun-native pubsub API.`,
    }), // "`Bun.serve`"),
    page("api/binary-data", "Binary data", {
      description: `How to represent and manipulate binary data in Bun.`,
    }), // "`Bun.serve`"),
    page("api/file-io", "File I/O", {
      description: `Read and write files fast with Bun's heavily optimized file system API.`,
    }), // "`Bun.write`"),
    page("api/sqlite", "SQLite", {
      description: `The fastest SQLite driver for JavaScript is baked directly into Bun.`,
    }), // "`bun:sqlite`"),
    page("api/file-system-router", "FileSystemRouter", {
      description: `Resolve incoming HTTP requests against a local file system directory with Bun's fast, Next.js-compatible router.`,
    }), // "`Bun.FileSystemRouter`"),
    page("api/tcp", "TCP Sockets", {
      description: `Bun's native API implements Web-standard TCP Sockets, plus a Bun-native API for building fast TCP servers.`,
    }), // "`Bun.{listen|connect}`")
    page("api/globals", "Globals", {
      description: `Bun implements a range of Web APIs, Node.js APIs, and Bun-native APIs that are available in the global scope.`,
    }), // "`Bun.write`"),
    page("api/spawn", "Spawn", {
      description: `Spawn sync and async child processes with easily configurable input and output streams.`,
    }), // "`Bun.spawn`"),
    page("api/transpiler", "Transpiler", {
      description: `Bun exposes its internal transpiler as a pluggable API.`,
    }), // "`Bun.Transpiler`"),
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
    // page("api/dns", "DNS", {
    //   description: `Resolve domain names to IP addresses.`,
    // }), // "`bun:dns`"),
    page("api/node-api", "Node-API", {
      description: `Bun implements the Node-API spec for building native addons.`,
    }), // "`Node-API`"),

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
    page("project/development", "Development", {
      description: "Learn how to contribute to Bun and get your local development environment up and running.",
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
