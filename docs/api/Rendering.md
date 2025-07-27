# Bun Rendering API

The Bun Rendering API is an experimental full-stack rendering system that provides React Server Components support, static site generation, hot module reloading, and framework-agnostic development. It's currently under heavy development and available in canary builds.

**⚠️ Warning: The Rendering API is experimental and APIs may change significantly.**

## Overview

The Bun Rendering API provides:

- **Framework-agnostic architecture** with React as a built-in example
- **React Server Components** with automatic client/server separation
- **File-based routing** with customizable patterns and styles
- **Advanced CSS hot module reloading** with framework integration
- **Static Site Generation** with dynamic parameter support
- **Hot Module Reloading (HMR)** for fast development
- **Production optimization** with automatic bundling and minification

## Quick Start

Create a `bun.app.ts` configuration file:

```typescript
// bun.app.ts
/// <reference path="node_modules/bun/src/bake/bake.d.ts" />

export default {
  port: 3000,
  app: {
    framework: "react", // Built-in React integration
  },
};
```

Start with:

```bash
bun run bun.app.ts
```

## CLI Commands

### Development Server

```bash
# Run configuration file
bun run bun.app.ts
bun bun.app.ts  # shorthand
```

### Production Build

```bash
# Build static site (default)
bun build --app bun.app.ts

# Build with specific entry point
bun build --app ./src/app.tsx
```

The production build always generates static sites by default, with `import.meta.env.STATIC` set to `true`.

## Framework Configuration

### Built-in React Integration

```typescript
// bun.app.ts
export default {
  app: {
    framework: "react", // Uses built-in React integration
  },
};
```

Requires React 19 experimental:
```bash
bun add react@experimental react-dom@experimental react-server-dom-webpack@experimental
```

The built-in React framework provides:
- Server Components with automatic client/server boundaries
- React Fast Refresh for instant feedback
- CSS hot reloading with framework navigation
- Static site generation with prerendering

### Custom Framework

Bake is designed to be framework-agnostic. Here's how to create a custom framework:

```typescript
import type { Bake } from "bun";

const customFramework: Bake.Framework = {
  // File-based routing configuration
  fileSystemRouterTypes: [{
    root: "pages",
    style: "nextjs-pages", // or "nextjs-app-ui", "nextjs-app-routes"
    serverEntryPoint: "./server.tsx",
    clientEntryPoint: "./client.tsx",
    layouts: true,
    ignoreUnderscores: true,
    extensions: ["tsx", "jsx"],
  }],
  
  // Static file serving
  staticRouters: ["public"],
  
  // Server Components configuration
  serverComponents: {
    separateSSRGraph: true,
    serverRuntimeImportSource: "react-server-dom-webpack/server",
    serverRegisterClientReferenceExport: "registerClientReference",
  },
  
  // Build options
  bundlerOptions: {
    client: {
      conditions: ["browser"],
    },
    server: {
      conditions: ["node"],
    },
    ssr: {
      conditions: ["react-server"],
    },
  },
  
  // Fast Refresh for React
  reactFastRefresh: {
    importSource: "react-refresh/runtime",
  },
  
  // Framework plugins
  plugins: [
    {
      name: "custom-framework-plugin",
      setup(build) {
        // Custom file transformations
        build.onLoad({ filter: /\.custom$/ }, async (args) => {
          const contents = await Bun.file(args.path).text();
          return {
            contents: transformCustomFile(contents),
            loader: "tsx",
          };
        });
      },
    },
  ],
};

export default {
  app: {
    framework: customFramework,
  },
};
```

### Non-React Framework Example (Svelte)

```typescript
import type { Bake } from "bun";
import * as svelte from "svelte/compiler";

export default function (): Bake.Framework {
  return {
    serverComponents: {
      separateSSRGraph: false,
      serverRuntimeImportSource: "./framework/server.ts",
    },
    fileSystemRouterTypes: [{
      root: "pages",
      serverEntryPoint: "./framework/server.ts",
      clientEntryPoint: "./framework/client.ts",
      style: "nextjs-pages",
      extensions: [".svelte"],
    }],
    plugins: [{
      name: "svelte-server-components",
      setup(build) {
        build.onLoad({ filter: /\.svelte$/ }, async (args) => {
          const contents = await Bun.file(args.path).text();
          const result = svelte.compile(contents, {
            filename: args.path,
            css: "external",
            hmr: true,
            dev: true,
            generate: args.side, // 'server' or 'client'
          });
          
          let jsCode = result.js.code;
          if (result.css) {
            jsCode = `import ${JSON.stringify("svelte-css:" + args.path)};` + jsCode;
          }
          
          return {
            contents: jsCode,
            loader: "js",
            watchFiles: [args.path],
          };
        });
      },
    }],
  };
}
```

## File-Based Routing

### Router Styles

Bake supports multiple routing conventions:

#### Next.js Pages Style (`"nextjs-pages"`)

```
pages/
├── index.tsx        # /
├── about.tsx        # /about
├── blog/
│   ├── index.tsx    # /blog
│   └── [slug].tsx   # /blog/:slug
└── _layout.tsx      # Layout for all pages
```

#### Next.js App Style (`"nextjs-app-ui"`)

```
app/
├── page.tsx         # /
├── layout.tsx       # Root layout
├── about/
│   └── page.tsx     # /about
└── blog/
    ├── page.tsx     # /blog
    ├── layout.tsx   # Blog layout
    └── [slug]/
        └── page.tsx # /blog/:slug
```

#### Custom Router Function

```typescript
const customRouter: Bake.CustomFileSystemRouterFunction = (path) => {
  if (path.endsWith(".page.tsx")) {
    return {
      pattern: path.replace(/\.page\.tsx$/, ""),
      type: "route",
    };
  }
  if (path.endsWith(".layout.tsx")) {
    return {
      pattern: path.replace(/\.layout\.tsx$/, ""),
      type: "layout",
    };
  }
  return undefined; // Skip file
};
```

### Dynamic Routes

```typescript
// pages/blog/[slug].tsx
interface Props {
  params: { slug: string };
}

export default function BlogPost({ params }: Props) {
  return <h1>Post: {params.slug}</h1>;
}

// For static site generation
export async function getStaticPaths() {
  const posts = await fetchBlogPosts();
  
  return {
    paths: posts.map(post => ({ params: { slug: post.slug } })),
    exhaustive: true, // All pages generated at build time
  };
}
```

### Layouts

```typescript
// pages/_layout.tsx (or app/layout.tsx)
interface Props {
  children: React.ReactNode;
  params?: Record<string, string>;
}

export default function RootLayout({ children }: Props) {
  return (
    <html>
      <head>
        <title>My App</title>
      </head>
      <body>
        <nav>Navigation</nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

## React Server Components

### Server Components (Default)

Server components run on the server and can access databases, APIs, etc:

```typescript
// pages/posts.tsx - Server Component
async function getPosts() {
  const response = await fetch("https://api.example.com/posts");
  return response.json();
}

export default async function PostsPage() {
  const posts = await getPosts();
  
  return (
    <div>
      <h1>Posts</h1>
      {posts.map(post => (
        <article key={post.id}>
          <h2>{post.title}</h2>
          <p>{post.content}</p>
        </article>
      ))}
    </div>
  );
}
```

### Client Components

Add `"use client"` for browser-only features:

```typescript
// components/Counter.tsx - Client Component
"use client";

import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState(0);
  
  return (
    <button onClick={() => setCount(count + 1)}>
      Count: {count}
    </button>
  );
}
```

### Mixed Usage

```typescript
// pages/dashboard.tsx - Server Component
import Counter from "../components/Counter"; // Client Component

async function getUser() {
  // Server-side data fetching
  return { name: "John", id: 1 };
}

export default async function Dashboard() {
  const user = await getUser();
  
  return (
    <div>
      <h1>Welcome, {user.name}!</h1>
      {/* This renders on the server */}
      <p>User ID: {user.id}</p>
      
      {/* This adds client-side interactivity */}
      <Counter />
    </div>
  );
}
```

## Static Site Generation

### Build Command

```bash
bun build --app bun.app.ts
```

This generates:
- **Static HTML files** for each route
- **Optimized JavaScript bundles** for client-side code
- **CSS files** with automatic optimization
- **RSC payload files** (`.rsc`) for seamless client navigation
- **Source maps** for debugging

### Dynamic Routes with Parameters

For routes with dynamic segments, you must export a `getParams` function:

```typescript
// pages/blog/[slug].tsx
export default function BlogPost({ params }: { params: { slug: string } }) {
  return <h1>Post: {params.slug}</h1>;
}

// Required for static generation of dynamic routes
export async function getParams(): Promise<Bake.GetParamIterator> {
  const posts = await fetchBlogPosts();
  
  return {
    pages: posts.map(post => ({ slug: post.slug })),
    exhaustive: true, // Build will fail if false and route is accessed
  };
}

// Alternative: Next.js compatibility
export async function getStaticPaths() {
  const posts = await fetchBlogPosts();
  
  return {
    paths: posts.map(post => ({ params: { slug: post.slug } })),
    fallback: false, // true = exhaustive: false
  };
}
```

### Streaming Parameter Generation

For large datasets, use async iterators:

```typescript
export async function* getParams() {
  for await (const batch of fetchPostsInBatches()) {
    for (const post of batch) {
      yield { slug: post.slug };
    }
  }
  return { exhaustive: false }; // More posts may exist
}
```

### Prerendering

Custom server entry points can implement prerendering:

```typescript
// server.tsx
export async function prerender(meta: Bake.RouteMetadata) {
  // Generate static files
  const html = await renderToStaticHtml(meta);
  const rscPayload = await generateRSCPayload(meta);
  
  return {
    files: {
      "/index.html": html,
      "/index.rsc": rscPayload, // For client navigation
      "/sitemap.xml": generateSitemap(),
    },
  };
}
```

## CSS & Styling

### Advanced CSS Hot Module Reloading

Bake features sophisticated CSS HMR that works with any framework:

- **Real-time CSS updates** without page reload
- **Framework-aware CSS management** during client-side navigation
- **MutationObserver-based tracking** of dynamically added/removed styles
- **CSSStyleSheet API** for instant style replacement
- **Automatic CSS bundling** and optimization

```typescript
// CSS is automatically hot-reloaded
import "./styles.css";

// CSS modules work seamlessly
import styles from "./component.module.css";

export default function Component() {
  return <div className={styles.container}>Styled component</div>;
}
```

### CSS Chunking and Loading

In production builds:
- CSS is automatically split by route
- Critical CSS is inlined
- Non-critical CSS is loaded asynchronously
- CSS files are fingerprinted for caching

## Development Features

### Hot Module Reloading

The Rendering API provides advanced HMR:

- **React Fast Refresh** with state preservation
- **CSS hot reloading** with instant updates
- **Server-side hot reloading** with automatic restart
- **Error overlay** with stack traces and source maps
- **File watching** with incremental rebuilds

### Environment Variables

```typescript
// Available in all modes
console.log(import.meta.env.MODE); // "development" or "production"
console.log(import.meta.env.SSR);  // true on server, false on client

// Only available in static builds
if (import.meta.env.STATIC) {
  // This code only runs in static builds
  console.log("Building static site");
}
```

### Development Modules

```typescript
// Available in development
import { onServerSideReload } from "bun:bake/client";

// Hot reload hook for custom frameworks
if (import.meta.env.DEV) {
  onServerSideReload(async () => {
    // Custom reload logic
    await reloadPage();
  });
}
```

## Server Entry Points

### Custom Server Implementation

```typescript
// server.tsx
import type { Bake } from "bun";

export async function render(
  request: Request, 
  meta: Bake.RouteMetadata
): Promise<Response> {
  const { pageModule, layouts, params, styles, modules } = meta;
  
  // Build component tree with layouts
  let route = <pageModule.default params={params} />;
  for (const layout of layouts) {
    const Layout = layout.default;
    route = <Layout params={params}>{route}</Layout>;
  }
  
  // Full HTML document
  const page = (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>My App</title>
        {styles.map(url => (
          <link key={url} rel="stylesheet" href={url} data-bake-ssr />
        ))}
      </head>
      <body>
        {route}
        {modules.map(url => (
          <script key={url} type="module" src={url} />
        ))}
      </body>
    </html>
  );
  
  // Render using React Server Components
  return await renderToResponse(page, meta, request);
}

// For static site generation
export async function prerender(meta: Bake.RouteMetadata) {
  return {
    files: {
      "/index.html": await renderToStaticHTML(meta),
      "/index.rsc": await generateRSCPayload(meta),
    },
  };
}

// For dynamic routes in static builds  
export async function getParams(meta: Bake.ParamsMetadata) {
  return {
    pages: await generateParams(meta.pageModule),
    exhaustive: true,
  };
}
```

### Client Entry Point

```typescript
// client.tsx
import { hydrateRoot } from "react-dom/client";
import { onServerSideReload } from "bun:bake/client";

// Hydrate server-rendered content
// The implementation handles RSC payloads and client navigation automatically

// Hot reload support in development
if (import.meta.env.DEV) {
  onServerSideReload(async () => {
    // Framework can implement custom reload logic
    await navigateToCurrentPage();
  });
}
```

## Production Deployment

### Build Output Structure

```bash
bun build --app bun.app.ts
```

Generates in `dist/`:
```
dist/
├── index.html              # Static HTML
├── index.rsc               # RSC payload for navigation
├── _bun/
│   ├── client.abc123.js    # Client bundle
│   ├── styles.def456.css   # Styles
│   └── assets/             # Static assets
└── blog/
    ├── hello/
    │   ├── index.html      # Dynamic route: /blog/hello
    │   └── index.rsc
    └── world/
        ├── index.html      # Dynamic route: /blog/world
        └── index.rsc
```

### Deployment Options

#### Static Hosting
Deploy the `dist/` folder to any static host:
```bash
# Upload to static hosting
rsync -av dist/ user@server:/var/www/myapp/
```

#### Server Deployment
For dynamic features, deploy with Bun:
```typescript
// production-server.ts
const server = Bun.serve({
  port: process.env.PORT || 3000,
  app: {
    framework: "react",
    bundlerOptions: {
      define: { "process.env.NODE_ENV": '"production"' },
    },
  },
});
```

## API Reference

### Rendering Options

```typescript
interface Options {
  framework: Framework | "react";
  bundlerOptions?: BundlerOptions;
  plugins?: BunPlugin[];
}
```

### RouteMetadata

```typescript
interface RouteMetadata {
  readonly pageModule: any;                    // Route module
  readonly layouts: ReadonlyArray<any>;        // Layout modules
  readonly params: Record<string, string> | null; // Route parameters
  readonly modules: ReadonlyArray<string>;     // JS files to load
  readonly modulepreload: ReadonlyArray<string>; // Files to preload
  readonly styles: ReadonlyArray<string>;      // CSS files
}
```

### Framework Configuration

```typescript
interface Framework {
  bundlerOptions?: BundlerOptions;
  fileSystemRouterTypes?: FrameworkFileSystemRouterType[];
  staticRouters?: Array<StaticRouter>;
  builtInModules?: BuiltInModule[];
  serverComponents?: ServerComponentsOptions;
  reactFastRefresh?: boolean | ReactFastRefreshOptions;
  plugins?: BunPlugin[];
}
```

### Special Modules

- `"bun:bake/server"` - Server manifest for client components
- `"bun:bake/client"` - Client-side reload hooks
- `"bun:bake/dev"` - Development utilities

## Current Limitations

Since the Rendering API is experimental:

- ⚠️ APIs may change significantly
- ⚠️ Limited documentation and examples
- ⚠️ Requires canary Bun builds
- ⚠️ React 19 experimental required for React integration
- ⚠️ No official plugin ecosystem yet

## Examples

### Custom Svelte Framework

```typescript
// bun.app.ts
import svelte from "./svelte-framework.ts";

export default {
  app: {
    framework: svelte(),
  },
};
```

### Multi-Framework App

```typescript
// Support multiple frameworks in one app
export default {
  app: {
    framework: {
      fileSystemRouterTypes: [
        {
          root: "react-pages",
          serverEntryPoint: "./react-server.tsx", 
          clientEntryPoint: "./react-client.tsx",
          style: "nextjs-pages",
          extensions: ["tsx"],
        },
        {
          root: "svelte-pages", 
          serverEntryPoint: "./svelte-server.ts",
          clientEntryPoint: "./svelte-client.ts", 
          style: "nextjs-pages",
          extensions: ["svelte"],
        },
      ],
      plugins: [reactPlugin, sveltePlugin],
    },
  },
};
```

### Advanced Static Site

```typescript
// pages/blog/[...slug].tsx - Catch-all route
export default function BlogPost({ params }: { params: { slug: string[] } }) {
  const path = params.slug.join('/');
  return <h1>Post: {path}</h1>;
}

export async function getParams() {
  const posts = await fetchAllBlogPosts();
  
  return {
    pages: posts.map(post => ({ 
      slug: post.path.split('/') 
    })),
    exhaustive: true,
  };
}
```

This documentation reflects the actual implementation of the Bun Rendering API as found in the Bun codebase. The API is experimental and under active development, with React serving as the primary built-in framework example while supporting any framework through the plugin system.