# Bun React Integration Template

This is a Bun React application with built-in support for React Server Components, file-based routing, and static site generation.

## Project Structure

```
.
├── bun.app.ts        # App configuration
├── pages/            # File-based routing directory
│   ├── index.tsx     # Home page (/)
│   ├── about.tsx     # Static route (/about)
│   ├── [slug].tsx    # Dynamic route (/anything)
│   └── [...path].tsx # Catch-all route
└── public/           # Static assets
```

## Getting Started

### Running the Application

```bash
bun run dev     # Start development server
bun run build   # Build for production
bun run start   # Start production server
```

## Configuration

The app is configured in `bun.app.ts`:

```tsx
// Basic configuration
export default { app: 'react' }

// Advanced configuration
export default {
  app: {
    framework: 'react',
    // Add custom bundler options, plugins, etc.
  }
}
```

## Features

### File-Based Routing

Create files in the `pages/` directory to automatically generate routes:

- `pages/index.tsx` → `/`
- `pages/about.tsx` → `/about`
- `pages/blog/index.tsx` → `/blog`
- `pages/blog/[slug].tsx` → `/blog/:slug` (dynamic)
- `pages/docs/[...path].tsx` → `/docs/*` (catch-all)

### React Server Components

This template supports both Server and Client components:

#### Server Components (default)

```tsx
// pages/server-page.tsx
// Server components can be async and fetch data directly
export default async function ServerPage() {
  const data = await fetch('https://api.example.com/data').then(r => r.json());
  
  return (
    <div>
      <h1>Server Component</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
```

#### Client Components

```tsx
// pages/client-page.tsx
"use client";

import { useState } from 'react';

export default function ClientPage() {
  const [count, setCount] = useState(0);
  
  return (
    <div>
      <h1>Client Component</h1>
      <button onClick={() => setCount(count + 1)}>
        Count: {count}
      </button>
    </div>
  );
}
```

### Static Site Generation (SSG)

For dynamic routes, use `getStaticPaths` to pre-render pages at build time:

```tsx
// pages/blog/[slug].tsx
import type { GetStaticPaths } from 'bun';

export const getStaticPaths: GetStaticPaths<{ slug: string }> = async () => {
  // Fetch all blog posts at build time
  const posts = await fetch('https://api.example.com/posts').then(r => r.json());
  
  return {
    paths: posts.map((post: any) => ({
      params: { slug: post.slug }
    }))
  };
};

export default function BlogPost({ params }: { params: { slug: string } }) {
  return <h1>Blog Post: {params.slug}</h1>;
}
```

#### Examples of `getStaticPaths`

**Multi-parameter routes:**
```tsx
// pages/products/[category]/[id].tsx
export const getStaticPaths: GetStaticPaths<{
  category: string;
  id: string;
}> = async () => {
  const products = await fetchProducts();
  
  return {
    paths: products.map(product => ({
      params: {
        category: product.category,
        id: product.id
      }
    }))
  };
};
```

**Catch-all routes:**
```tsx
// pages/docs/[...path].tsx
export const getStaticPaths: GetStaticPaths<{ path: string[] }> = async () => {
  const docPaths = await getDocumentationPaths();
  
  return {
    paths: docPaths.map(docPath => ({
      params: { path: docPath.split('/') }
    }))
  };
};
```

### Custom Response Handling

Server components can return custom `Response` objects:

```tsx
// pages/custom-response.tsx
export default async function CustomResponsePage({ searchParams }: any) {
  // Rewrite to another page
  if (searchParams.rewrite) {
    return Response.render("/other-page");
  }
  
  // HTTP redirect
  if (searchParams.redirect) {
    return Response.redirect("/redirected");
  }
  
  // Custom response with headers
  if (searchParams.custom) {
    return Response(
      <div>Custom Response</div>,
      {
        headers: {
          'X-Custom-Header': 'value'
        },
        status: 200
      }
    );
  }
  
  return <div>Normal rendering</div>;
}
```

## Advanced Configuration

### Framework Options

You can customize the framework behavior in `bun.app.ts`:

```tsx
export default {
  app: {
    framework: 'react',
    bundlerOptions: {
      // Custom bundler options
    },
    staticRouters: ['public', 'static'],
    reactFastRefresh: true,
    serverComponents: {
      // Server components configuration
    },
    plugins: [
      // Bun plugins
    ]
  }
}
```

### Available Framework Configuration

- `bundlerOptions`: Customize bundler behavior
- `fileSystemRouterTypes`: Configure routing conventions
- `staticRouters`: Directories to serve statically (default: `['public']`)
- `builtInModules`: Add or replace built-in modules
- `serverComponents`: React Server Components configuration
- `reactFastRefresh`: Enable/configure Fast Refresh for development
- `plugins`: Framework-specific bundler plugins

## Common Patterns

### Layout Components

Create a shared layout for your pages:

```tsx
// components/Layout.tsx
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <title>My App</title>
      </head>
      <body>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

### Data Fetching in Server Components

```tsx
// pages/products.tsx
async function getProducts() {
  const response = await fetch('https://api.example.com/products', {
    next: { revalidate: 3600 } // Cache for 1 hour
  });
  return response.json();
}

export default async function ProductsPage() {
  const products = await getProducts();
  
  return (
    <div>
      <h1>Products</h1>
      <ul>
        {products.map((product: any) => (
          <li key={product.id}>{product.name}</li>
        ))}
      </ul>
    </div>
  );
}
```

### Mixing Server and Client Components

```tsx
// pages/dashboard.tsx (Server Component)
import ClientCounter from '../components/ClientCounter';

export default async function Dashboard() {
  const serverData = await fetchDashboardData();
  
  return (
    <div>
      <h1>Dashboard</h1>
      <div>Server-rendered data: {serverData.message}</div>
      <ClientCounter initialCount={serverData.count} />
    </div>
  );
}

// components/ClientCounter.tsx (Client Component)
"use client";

import { useState } from 'react';

export default function ClientCounter({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);
  
  return (
    <button onClick={() => setCount(c => c + 1)}>
      Client count: {count}
    </button>
  );
}
```

## Development Tips

1. **Server Components are default**: Files in `pages/` are Server Components unless marked with `"use client"`
2. **Use `getStaticPaths` for dynamic routes**: Pre-render dynamic pages at build time for better performance
3. **Leverage Server Components**: Fetch data directly in components without client-side loading states
4. **Static assets**: Place static files in the `public/` directory
5. **Fast Refresh**: Enabled by default in development for instant feedback

## Experimental Features

⚠️ Note: These APIs are experimental and may change in future releases:
- `getStaticPaths` API
- Custom `Response` handling in Server Components
- Some framework configuration options

## Troubleshooting

### Common Issues

**Pages not routing correctly:**
- Ensure files are in the `pages/` directory
- Check file naming (use `.tsx` or `.jsx` extensions)
- Restart the dev server after adding new pages

**Client components not interactive:**
- Add `"use client"` directive at the top of the file
- Ensure client-only hooks (useState, useEffect) are in client components

**Build errors with dynamic routes:**
- Implement `getStaticPaths` for all dynamic route segments
- Ensure params match the file name pattern

## Additional Resources

- [Bun Documentation](https://bun.sh/docs)
- [React Server Components](https://react.dev/reference/rsc/server-components)
- [React Documentation](https://react.dev)