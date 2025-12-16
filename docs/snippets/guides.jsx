export const GuidesList = () => {
  const guidesData = {
    hero: {
      title: "Guides",
      blurb: "A collection of code samples and walkthroughs for performing common tasks with Bun.",
    },
    featured: [
      {
        category: "Ecosystem",
        title: "Use Tanstack Start with Bun",
        href: "/guides/ecosystem/tanstack-start",
        cta: "View guide",
      },
      {
        category: "Ecosystem",
        title: "Use Next.js with Bun",
        href: "/guides/ecosystem/nextjs",
        cta: "View guide",
      },
      {
        category: "Ecosystem",
        title: "Build a frontend using Vite and Bun",
        href: "/guides/ecosystem/vite",
        cta: "View guide",
      },
      {
        category: "Runtime",
        title: "Install TypeScript declarations for Bun",
        href: "/guides/runtime/typescript",
        cta: "View guide",
      },
      {
        category: "HTTP",
        title: "Write a simple HTTP server",
        href: "/guides/http/simple",
        cta: "View guide",
      },
      {
        category: "WebSocket",
        title: "Build a simple WebSocket server",
        href: "/guides/websocket/simple",
        cta: "View guide",
      },
    ],
    categories: [
      {
        key: "deployment",
        title: "Deployment",
        icon: "rocket",
        items: [
          { title: "Deploy Bun on Vercel", href: "/guides/deployment/vercel" },
          { title: "Deploy Bun on Railway", href: "/guides/deployment/railway" },
          { title: "Deploy Bun on Render", href: "/guides/deployment/render" },
        ],
      },
      {
        key: "binary",
        title: "Binary data",
        icon: "binary",
        items: [
          {
            title: "Convert an ArrayBuffer to an array of numbers",
            href: "/guides/binary/arraybuffer-to-array",
          },
          { title: "Convert an ArrayBuffer to a Blob", href: "/guides/binary/arraybuffer-to-blob" },
          {
            title: "Convert an ArrayBuffer to a Buffer",
            href: "/guides/binary/arraybuffer-to-buffer",
          },
          {
            title: "Convert an ArrayBuffer to a string",
            href: "/guides/binary/arraybuffer-to-string",
          },
          {
            title: "Convert an ArrayBuffer to a Uint8Array",
            href: "/guides/binary/arraybuffer-to-typedarray",
          },
          { title: "Convert a Blob to an ArrayBuffer", href: "/guides/binary/blob-to-arraybuffer" },
          { title: "Convert a Blob to a DataView", href: "/guides/binary/blob-to-dataview" },
          { title: "Convert a Blob to a ReadableStream", href: "/guides/binary/blob-to-stream" },
          { title: "Convert a Blob to a string", href: "/guides/binary/blob-to-string" },
          { title: "Convert a Blob to a Uint8Array", href: "/guides/binary/blob-to-typedarray" },
          {
            title: "Convert a Buffer to an ArrayBuffer",
            href: "/guides/binary/buffer-to-arraybuffer",
          },
          { title: "Convert a Buffer to a blob", href: "/guides/binary/buffer-to-blob" },
          {
            title: "Convert a Buffer to a ReadableStream",
            href: "/guides/binary/buffer-to-readablestream",
          },
          { title: "Convert a Buffer to a string", href: "/guides/binary/buffer-to-string" },
          {
            title: "Convert a Buffer to a Uint8Array",
            href: "/guides/binary/buffer-to-typedarray",
          },
          { title: "Convert a DataView to a string", href: "/guides/binary/dataview-to-string" },
          {
            title: "Convert a Uint8Array to an ArrayBuffer",
            href: "/guides/binary/typedarray-to-arraybuffer",
          },
          { title: "Convert a Uint8Array to a Blob", href: "/guides/binary/typedarray-to-blob" },
          {
            title: "Convert a Uint8Array to a Buffer",
            href: "/guides/binary/typedarray-to-buffer",
          },
          {
            title: "Convert a Uint8Array to a DataView",
            href: "/guides/binary/typedarray-to-dataview",
          },
          {
            title: "Convert a Uint8Array to a ReadableStream",
            href: "/guides/binary/typedarray-to-readablestream",
          },
          {
            title: "Convert a Uint8Array to a string",
            href: "/guides/binary/typedarray-to-string",
          },
        ],
      },
      {
        key: "ecosystem",
        title: "Ecosystem",
        icon: "puzzle",
        items: [
          { title: "Use Gel with Bun", href: "/guides/ecosystem/gel" },
          { title: "Use Prisma ORM with Bun", href: "/guides/ecosystem/prisma" },
          { title: "Use Prisma Postgres with Bun", href: "/guides/ecosystem/prisma-postgres" },
          { title: "Create a Discord bot", href: "/guides/ecosystem/discordjs" },
          { title: "Add Sentry to a Bun app", href: "/guides/ecosystem/sentry" },
          { title: "Use Drizzle ORM with Bun", href: "/guides/ecosystem/drizzle" },
          { title: "Build a React app with Bun", href: "/guides/ecosystem/react" },
          { title: "Run Bun as a daemon with PM2", href: "/guides/ecosystem/pm2" },
          { title: "Build an app with Nuxt and Bun", href: "/guides/ecosystem/nuxt" },
          { title: "Build an app with Qwik and Bun", href: "/guides/ecosystem/qwik" },
          { title: "Build an app with Astro and Bun", href: "/guides/ecosystem/astro" },
          { title: "Build an app with Remix and Bun", href: "/guides/ecosystem/remix" },
          { title: "Use TanStack Start with Bun", href: "/guides/ecosystem/tanstack-start" },
          { title: "Run Bun as a daemon with systemd", href: "/guides/ecosystem/systemd" },
          { title: "Build an app with Next.js and Bun", href: "/guides/ecosystem/nextjs" },
          { title: "Build an app with SvelteKit and Bun", href: "/guides/ecosystem/sveltekit" },
          { title: "Build a frontend using Vite and Bun", href: "/guides/ecosystem/vite" },
          { title: "Build an app with SolidStart and Bun", href: "/guides/ecosystem/solidstart" },
          {
            title: "Use Neon Postgres through Drizzle ORM",
            href: "/guides/ecosystem/neon-drizzle",
          },
          { title: "Build an HTTP server using Hono and Bun", href: "/guides/ecosystem/hono" },
          {
            title: "Use Neon\'s Serverless Postgres with Bun",
            href: "/guides/ecosystem/neon-serverless-postgres",
          },
          { title: "Build an HTTP server using Elysia and Bun", href: "/guides/ecosystem/elysia" },
          { title: "Containerize a Bun application with Docker", href: "/guides/ecosystem/docker" },
          {
            title: "Build an HTTP server using Express and Bun",
            href: "/guides/ecosystem/express",
          },
          {
            title: "Server-side render (SSR) a React component",
            href: "/guides/ecosystem/ssr-react",
          },
          { title: "Build an HTTP server using StricJS and Bun", href: "/guides/ecosystem/stric" },
          {
            title: "Read and write data to MongoDB using Mongoose and Bun",
            href: "/guides/ecosystem/mongoose",
          },
        ],
      },
      {
        key: "htmlrewriter",
        title: "HTMLRewriter",
        icon: "file-code-2",
        items: [
          {
            title: "Extract links from a webpage using HTMLRewriter",
            href: "/guides/html-rewriter/extract-links",
          },
          {
            title: "Extract social share images and Open Graph tags",
            href: "/guides/html-rewriter/extract-social-meta",
          },
        ],
      },
      {
        key: "http",
        title: "HTTP",
        icon: "globe",
        items: [
          { title: "Common HTTP server usage", href: "/guides/http/server" },
          { title: "Hot reload an HTTP server", href: "/guides/http/hot" },
          { title: "Write a simple HTTP server", href: "/guides/http/simple" },
          { title: "Start a cluster of HTTP servers", href: "/guides/http/cluster" },
          { title: "Configure TLS on an HTTP server", href: "/guides/http/tls" },
          { title: "Send an HTTP request using fetch", href: "/guides/http/fetch" },
          { title: "Proxy HTTP requests using fetch()", href: "/guides/http/proxy" },
          { title: "Stream a file as an HTTP Response", href: "/guides/http/stream-file" },
          { title: "Upload files via HTTP using FormData", href: "/guides/http/file-uploads" },
          { title: "fetch with unix domain sockets in Bun", href: "/guides/http/fetch-unix" },
          {
            title: "Streaming HTTP Server with Async Iterators",
            href: "/guides/http/stream-iterator",
          },
          {
            title: "Streaming HTTP Server with Node.js Streams",
            href: "/guides/http/stream-node-streams-in-bun",
          },
        ],
      },
      {
        key: "install",
        title: "Package manager",
        icon: "package",
        items: [
          { title: "Add a dependency", href: "/guides/install/add" },
          { title: "Add a Git dependency", href: "/guides/install/add-git" },
          { title: "Add a peer dependency", href: "/guides/install/add-peer" },
          { title: "Add a tarball dependency", href: "/guides/install/add-tarball" },
          { title: "Add a trusted dependency", href: "/guides/install/trusted" },
          { title: "Add an optional dependency", href: "/guides/install/add-optional" },
          { title: "Add a development dependency", href: "/guides/install/add-dev" },
          {
            title: "Using bun install with Artifactory",
            href: "/guides/install/jfrog-artifactory",
          },
          { title: "Generate a yarn-compatible lockfile", href: "/guides/install/yarnlock" },
          {
            title: "Migrate from npm install to bun install",
            href: "/guides/install/from-npm-install-to-bun-install",
          },
          { title: "Configuring a monorepo using workspaces", href: "/guides/install/workspaces" },
          { title: "Install a package under a different name", href: "/guides/install/npm-alias" },
          {
            title: "Configure git to diff Bun\'s lockb lockfile",
            href: "/guides/install/git-diff-bun-lockfile",
          },
          {
            title: "Install dependencies with Bun in GitHub Actions",
            href: "/guides/install/cicd",
          },
          {
            title: "Override the default npm registry for bun install",
            href: "/guides/install/custom-registry",
          },
          {
            title: "Using bun install with an Azure Artifacts npm registry",
            href: "/guides/install/azure-artifacts",
          },
          {
            title: "Configure a private registry for an organization scope with bun install",
            href: "/guides/install/registry-scope",
          },
        ],
      },
      {
        key: "processes",
        title: "Processes",
        icon: "cpu",
        items: [
          { title: "Read from stdin", href: "/guides/process/stdin" },
          { title: "Listen for CTRL+C", href: "/guides/process/ctrl-c" },
          { title: "Listen to OS signals", href: "/guides/process/os-signals" },
          { title: "Spawn a child process", href: "/guides/process/spawn" },
          { title: "Parse command-line arguments", href: "/guides/process/argv" },
          { title: "Read stderr from a child process", href: "/guides/process/spawn-stderr" },
          { title: "Read stdout from a child process", href: "/guides/process/spawn-stdout" },
          { title: "Get the process uptime in nanoseconds", href: "/guides/process/nanoseconds" },
          { title: "Spawn a child process and communicate using IPC", href: "/guides/process/ipc" },
        ],
      },
      {
        key: "read-file",
        title: "Reading files",
        icon: "file",
        items: [
          { title: "Read a JSON file", href: "/guides/read-file/json" },
          { title: "Check if a file exists", href: "/guides/read-file/exists" },
          { title: "Read a file to a Buffer", href: "/guides/read-file/buffer" },
          { title: "Read a file as a string", href: "/guides/read-file/string" },
          { title: "Get the MIME type of a file", href: "/guides/read-file/mime" },
          { title: "Read a file to a Uint8Array", href: "/guides/read-file/uint8array" },
          { title: "Read a file to an ArrayBuffer", href: "/guides/read-file/arraybuffer" },
          { title: "Watch a directory for changes", href: "/guides/read-file/watch" },
          { title: "Read a file as a ReadableStream", href: "/guides/read-file/stream" },
        ],
      },
      {
        key: "runtime",
        title: "Runtime",
        icon: "bot",
        items: [
          { title: "Delete files", href: "/guides/runtime/delete-file" },
          { title: "Delete directories", href: "/guides/runtime/delete-directory" },
          { title: "Import a JSON file", href: "/guides/runtime/import-json" },
          { title: "Import a TOML file", href: "/guides/runtime/import-toml" },
          { title: "Import a YAML file", href: "/guides/runtime/import-yaml" },
          { title: "Run a Shell Command", href: "/guides/runtime/shell" },
          { title: "Re-map import paths", href: "/guides/runtime/tsconfig-paths" },
          { title: "Set a time zone in Bun", href: "/guides/runtime/timezone" },
          { title: "Set environment variables", href: "/guides/runtime/set-env" },
          { title: "Import a HTML file as text", href: "/guides/runtime/import-html" },
          { title: "Read environment variables", href: "/guides/runtime/read-env" },
          {
            title: "Build-time constants with --define",
            href: "/guides/runtime/build-time-constants",
          },
          { title: "Debugging Bun with the web debugger", href: "/guides/runtime/web-debugger" },
          { title: "Install and run Bun in GitHub Actions", href: "/guides/runtime/cicd" },
          { title: "Install TypeScript declarations for Bun", href: "/guides/runtime/typescript" },
          {
            title: "Debugging Bun with the VS Code extension",
            href: "/guides/runtime/vscode-debugger",
          },
          {
            title: "Inspect memory usage using V8 heap snapshots",
            href: "/guides/runtime/heap-snapshot",
          },
          {
            title: "Define and replace static globals & constants",
            href: "/guides/runtime/define-constant",
          },
          {
            title: "Codesign a single-file JavaScript executable on macOS",
            href: "/guides/runtime/codesign-macos-executable",
          },
        ],
      },
      {
        key: "streams",
        title: "Streams",
        icon: "waves",
        items: [
          { title: "Convert a ReadableStream to JSON", href: "/guides/streams/to-json" },
          {
            title: "Convert a Node.js Readable to JSON",
            href: "/guides/streams/node-readable-to-json",
          },
          { title: "Convert a ReadableStream to a Blob", href: "/guides/streams/to-blob" },
          {
            title: "Convert a Node.js Readable to a Blob",
            href: "/guides/streams/node-readable-to-blob",
          },
          { title: "Convert a ReadableStream to a Buffer", href: "/guides/streams/to-buffer" },
          { title: "Convert a ReadableStream to a string", href: "/guides/streams/to-string" },
          {
            title: "Convert a Node.js Readable to a string",
            href: "/guides/streams/node-readable-to-string",
          },
          {
            title: "Convert a ReadableStream to a Uint8Array",
            href: "/guides/streams/to-typedarray",
          },
          {
            title: "Convert a ReadableStream to an ArrayBuffer",
            href: "/guides/streams/to-arraybuffer",
          },
          {
            title: "Convert a Node.js Readable to an Uint8Array",
            href: "/guides/streams/node-readable-to-uint8array",
          },
          {
            title: "Convert a Node.js Readable to an ArrayBuffer",
            href: "/guides/streams/node-readable-to-arraybuffer",
          },
          {
            title: "Convert a ReadableStream to an array of chunks",
            href: "/guides/streams/to-array",
          },
        ],
      },
      {
        key: "test",
        title: "Test runner",
        icon: "test-tube",
        items: [
          { title: "Mock functions in bun test", href: "/guides/test/mock-functions" },
          { title: "Spy on methods in bun test", href: "/guides/test/spy-on" },
          { title: "Using Testing Library with Bun", href: "/guides/test/testing-library" },
          { title: "Update snapshots in bun test", href: "/guides/test/update-snapshots" },
          { title: "Run tests in watch mode with Bun", href: "/guides/test/watch-mode" },
          { title: "Use snapshot testing in bun test", href: "/guides/test/snapshot" },
          { title: "Bail early with the Bun test runner", href: "/guides/test/bail" },
          { title: "Skip tests with the Bun test runner", href: "/guides/test/skip-tests" },
          {
            title: "Migrate from Jest to Bun's test runner",
            href: "/guides/test/migrate-from-jest",
          },
          { title: "Run your tests with the Bun test runner", href: "/guides/test/run-tests" },
          { title: "Set the system time in Bun's test runner", href: "/guides/test/mock-clock" },
          {
            title: "Write browser DOM tests with Bun and happy-dom",
            href: "/guides/test/happy-dom",
          },
          {
            title: "Set a per-test timeout with the Bun test runner",
            href: "/guides/test/timeout",
          },
          {
            title: 'Mark a test as a "todo" with the Bun test runner',
            href: "/guides/test/todo-tests",
          },
          {
            title: "Re-run tests multiple times with the Bun test runner",
            href: "/guides/test/rerun-each",
          },
          {
            title: "Set a code coverage threshold with the Bun test runner",
            href: "/guides/test/coverage-threshold",
          },
          {
            title: "Selectively run tests concurrently with glob patterns",
            href: "/guides/test/concurrent-test-glob",
          },
          {
            title: "Generate code coverage reports with the Bun test runner",
            href: "/guides/test/coverage",
          },
          {
            title: "import, require, and test Svelte components with bun test",
            href: "/guides/test/svelte-test",
          },
        ],
      },
      {
        key: "utilities",
        title: "Utilities",
        icon: "wrench",
        items: [
          { title: "Hash a password", href: "/guides/util/hash-a-password" },
          { title: "Generate a UUID", href: "/guides/util/javascript-uuid" },
          { title: "Escape an HTML string", href: "/guides/util/escape-html" },
          { title: "Get the current Bun version", href: "/guides/util/version" },
          { title: "Encode and decode base64 strings", href: "/guides/util/base64" },
          { title: "Check if two objects are deeply equal", href: "/guides/util/deep-equals" },
          { title: "Detect when code is executed with Bun", href: "/guides/util/detect-bun" },
          { title: "Get the directory of the current file", href: "/guides/util/import-meta-dir" },
          { title: "Get the file name of the current file", href: "/guides/util/import-meta-file" },
          {
            title: "Convert a file URL to an absolute path",
            href: "/guides/util/file-url-to-path",
          },
          { title: "Compress and decompress data with gzip", href: "/guides/util/gzip" },
          {
            title: "Convert an absolute path to a file URL",
            href: "/guides/util/path-to-file-url",
          },
          {
            title: "Get the path to an executable bin file",
            href: "/guides/util/which-path-to-executable-bin",
          },
          { title: "Sleep for a fixed number of milliseconds", href: "/guides/util/sleep" },
          { title: "Compress and decompress data with DEFLATE", href: "/guides/util/deflate" },
          {
            title: "Get the absolute path of the current file",
            href: "/guides/util/import-meta-path",
          },
          { title: "Check if the current file is the entrypoint", href: "/guides/util/entrypoint" },
          { title: "Get the absolute path to the current entrypoint", href: "/guides/util/main" },
        ],
      },
      {
        key: "websocket",
        title: "WebSocket",
        icon: "radio",
        items: [
          { title: "Build a simple WebSocket server", href: "/guides/websocket/simple" },
          {
            title: "Enable compression for WebSocket messages",
            href: "/guides/websocket/compression",
          },
          { title: "Build a publish-subscribe WebSocket server", href: "/guides/websocket/pubsub" },
          {
            title: "Set per-socket contextual data on a WebSocket",
            href: "/guides/websocket/context",
          },
        ],
      },
      {
        key: "write-file",
        title: "Writing files",
        icon: "file-pen",
        items: [
          { title: "Delete a file", href: "/guides/write-file/unlink" },
          { title: "Write to stdout", href: "/guides/write-file/stdout" },
          { title: "Write a Blob to a file", href: "/guides/write-file/blob" },
          { title: "Write a file to stdout", href: "/guides/write-file/cat" },
          { title: "Append content to a file", href: "/guides/write-file/append" },
          { title: "Write a string to a file", href: "/guides/write-file/basic" },
          { title: "Write a file incrementally", href: "/guides/write-file/filesink" },
          { title: "Write a Response to a file", href: "/guides/write-file/response" },
          { title: "Copy a file to another location", href: "/guides/write-file/file-cp" },
          { title: "Write a ReadableStream to a file", href: "/guides/write-file/stream" },
        ],
      },
    ],
  };

  return (
    <div id="guides-list">
      {/* Featured cards */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold mb-6">Featured</h2>
        <Columns cols={3}>
          {guidesData.featured.map(g => (
            <Card key={g.href} title={g.title} href={g.href} cta={g.cta} />
          ))}
        </Columns>
      </div>
      {/* All guides organized by category */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-6">All Guides</h2>
        {guidesData.categories.map(category => (
          <div key={category.key} className="mb-8">
            <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">{category.title}</h3>
            <Columns cols={3}>
              {category.items.map(guide => (
                <Card key={guide.href} title={guide.title} description=" " href={guide.href} cta="" />
              ))}
            </Columns>
          </div>
        ))}
      </div>
    </div>
  );
};
