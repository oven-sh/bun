# Bake: Full-Stack Web Framework

Bake is Bun's experimental full-stack web framework that provides server-side rendering with React Server Components support, static site generation, and hot module reloading. It's currently under heavy development and available in canary builds.

**⚠️ Warning: Bake is experimental software and APIs may change significantly.**

## Overview

Bake provides:

- **React Server Components** with automatic client/server separation
- **File-based routing** with Next.js-style conventions
- **Hot Module Reloading (HMR)** for development
- **Static Site Generation** for production builds
- **Configuration-driven development** with framework detection
- **TypeScript support** out-of-the-box

## Quick Start

Create a `bun.app.ts` configuration file:

```typescript
// bun.app.ts
/// <reference path="node_modules/bun/src/bake/bake.d.ts" />

export default {
  port: 3000,
  app: {
    framework: "react", // Built-in React framework
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
# Build static site
bun build --app bun.app.ts

# Build with specific entry point
bun build --app ./src/app.tsx
```

## Configuration

### Built-in React Framework

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

### Custom Framework

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
  
  // React Server Components
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
};

export default {
  app: {
    framework: customFramework,
  },
};
```

## File-Based Routing

### Basic Routes (Next.js Pages Style)

```
pages/
├── index.tsx        # / 
├── about.tsx        # /about
├── blog/
│   ├── index.tsx    # /blog
│   └── [slug].tsx   # /blog/:slug
└── _layout.tsx      # Layout for all pages
```

```typescript
// pages/index.tsx
export default function HomePage() {
  return <h1>Welcome!</h1>;
}

// pages/blog/[slug].tsx  
interface Props {
  params: { slug: string };
}

export default function BlogPost({ params }: Props) {
  return <h1>Post: {params.slug}</h1>;
}
```

### App Router Style

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
        <title>Bun + React Server Components</title>
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
  
  // This uses React Server Components to render
  // See /workspace/bun/src/bake/bun-framework-react/server.tsx for implementation
  return renderToResponse(page, request);
}

// For static site generation
export async function prerender(meta: Bake.RouteMetadata) {
  // Generate static HTML and RSC payload
  return {
    files: {
      "/index.html": htmlBlob,
      "/index.rsc": rscPayload, // For client navigation
    },
  };
}

// For dynamic routes
export async function getParams(meta: Bake.ParamsMetadata) {
  return {
    pages: [{ slug: "hello" }, { slug: "world" }],
    exhaustive: true, // All pages generated at build time
  };
}
```

### Client Entry Point

```typescript
// client.tsx
import { hydrateRoot } from "react-dom/client";
import { onServerSideReload } from "bun:bake/client";

// Hydrate the server-rendered content
// Implementation handles RSC payload and client navigation
// See /workspace/bun/src/bake/bun-framework-react/client.tsx

// Hot reload support in development
if (import.meta.env.DEV) {
  onServerSideReload(async () => {
    // Reload page content without full page refresh
    await reloadCurrentPage();
  });
}
```

## Static Site Generation

### Build Command

```bash
bun build --app bun.app.ts
```

This generates:
- Static HTML files for each route
- Optimized JavaScript bundles
- CSS files with automatic optimization
- RSC payload files for client navigation

### Dynamic Routes

```typescript
// pages/blog/[slug].tsx
export default function BlogPost({ params }: { params: { slug: string } }) {
  return <h1>Post: {params.slug}</h1>;
}

// Generate static paths
export async function getStaticPaths() {
  const posts = await fetchBlogPosts();
  
  return {
    paths: posts.map(post => ({ params: { slug: post.slug } })),
    exhaustive: true, // Build all pages at build time
  };
}
```

## Development Features

### Hot Module Reloading

Bake provides fast development feedback:

- **Component updates** preserve React state
- **CSS hot reloading** without page refresh  
- **Server-side changes** trigger automatic reload
- **Error overlay** with stack traces

### Development Modules

```typescript
// Available in development
import { onServerSideReload } from "bun:bake/client";

// Debug utilities (DEV only)
if (import.meta.env.DEV) {
  console.log(window.$bake.currentCssList);
  window.$bake.goto("/new-page");
}
```

### HMR WebSocket

Development server uses WebSocket at `/_bun/hmr` for:
- File change notifications
- Error reporting
- CSS reload signals
- React Fast Refresh

## Bundler Integration

### CSS Support

```typescript
// Automatic CSS loading
import "./styles.css";

// CSS is automatically:
// - Bundled and optimized
// - Hot reloaded in development
// - Managed during client navigation
```

### Asset Handling

```typescript
// Assets served at /_bun/asset/<key>
// Automatic optimization and caching
import logo from "./logo.png";

function Header() {
  return <img src={logo} alt="Logo" />;
}
```

## API Reference

### Bake.Options

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

### Special Modules

- `"bun:bake/server"` - Server manifest for client components
- `"bun:bake/client"` - Client-side reload hooks  
- `"bun:bake/dev"` - Development utilities

## Production Deployment

### Build Output

```bash
bun build --app bun.app.ts
```

Generates `dist/` with:
- `index.html` - Static HTML
- `index.rsc` - RSC payload for navigation
- `assets/` - Optimized JS/CSS bundles

### Server Deployment

```typescript
// For dynamic server rendering
const server = Bun.serve({
  port: 3000,
  app: {
    framework: "react",
    bundlerOptions: {
      define: { "process.env.NODE_ENV": '"production"' },
    },
  },
});
```

## Current Limitations

Since Bake is experimental:

- ⚠️ APIs may change significantly  
- ⚠️ Limited documentation and examples
- ⚠️ Requires canary Bun builds
- ⚠️ React 19 experimental required
- ⚠️ No official plugin ecosystem yet

## Examples

### Server Components App

```typescript
// bun.app.ts
export default {
  app: {
    framework: "react",
  },
};
```

```typescript
// pages/index.tsx - Server Component
async function getData() {
  return { message: "Hello from server!" };
}

export default async function HomePage() {
  const data = await getData();
  return <h1>{data.message}</h1>;
}
```

This documentation reflects the actual implementation of Bake as found in the Bun codebase. The framework is experimental and under active development.