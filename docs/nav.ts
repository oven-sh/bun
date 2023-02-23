export type Nav = {
  items: NavItem[];
};

export type NavItem = NavPage | NavDivider;
export type NavPage = {
  type: "page";
  slug: string;
  title: string;
};
type NavDivider = {
  type: "divider";
  title: string;
};

function page(slug: string, title: string): NavPage {
  return { type: "page", slug, title };
}
function divider(title: string): NavDivider {
  return { type: "divider", title };
}

export default {
  items: [
    divider("Intro"),
    page("index", "What is Bun?"),
    page("installation", "Installation"),
    page("quickstart", "Quickstart"),
    page("typescript", "TypeScript"),

    divider("CLI"),
    page("cli/run", "`bun run`"),
    page("cli/install", "`bun install`"),
    page("cli/test", "`bun test`"),
    page("cli/create", "`bun create`"),
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
    page("runtime/index", "Runtime"),
    // page("runtime/web-apis", "Web APIs"),
    page("runtime/modules", "Module resolution"),
    page("runtime/hot", "Hot reloading"),
    // page("runtime/loaders", "Loaders"),
    page("runtime/plugins", "Plugins"),
    page("runtime/nodejs", "Node.js APIs"),

    divider("API"),
    page("api/http", "HTTP"), // "`Bun.serve`"),
    page("api/file-io", "File I/O"), // "`Bun.write`"),
    page("api/sqlite", "SQLite"), // "`bun:sqlite`"),
    page("api/file-system-router", "FileSystemRouter"), // "`Bun.FileSystemRouter`"),
    page("api/globals", "Globals"), // "`Bun.write`"),
    page("api/tcp", "TCP"), // "`Bun.{listen|connect}`"),
    page("api/spawn", "Spawn"), // "`Bun.spawn`"),
    page("api/transpiler", "Transpiler"), // "`Bun.Transpiler`"),
    page("api/console", "Console"), // "`Node-API`"),
    page("api/dns", "DNS"), // "`bun:dns`"),
    page("api/ffi", "FFI"), // "`bun:ffi`"),
    page("api/html-rewriter", "HTMLRewriter"), // "`HTMLRewriter`"),
    page("api/node-api", "Node-API"), // "`Node-API`"),
    page("api/test", "Testing"), // "`bun:test`"),
    page("api/utils", "Utils"), // "`Bun.peek`"),
    page("api/websockets", "WebSocket"), // "`Bun.serve`"),

    // divider("Dev Server"),
    // page("bun-dev", "Vanilla"),
    // page("dev/css", "CSS"),
    // page("dev/frameworks", "Frameworks"),
    // page("dev/nextjs", "Next.js"),
    // page("dev/cra", "Create React App"),

    divider("Project"),
    page("project/roadmap", "Roadmap"),
    page("project/configuration", "Configuration"),
    page("project/profiling", "Profiling"),
    page("project/developing", "Development"),
    page("project/licensing", "License"),

    // misc
    // page("roadmap", "Roadmap"),
    // page("troubleshooting", "Troubleshooting"),
    // page("bunfig", "bunfig.toml"),
    // page("upgrading-webkit", "Upgrading WebKit"),
    // page("bun-flavored-toml", "Bun-flavored TOML"),
  ],
} satisfies Nav;
