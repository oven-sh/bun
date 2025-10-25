Bun provides a fast API for resolving routes against file-system paths. This API is primarily intended for library authors. It supports both Next.js-style routing and [React Router file route conventions](https://reactrouter.com/how-to/file-route-conventions).

## Next.js-style

The `FileSystemRouter` class can resolve routes against a `pages` directory. (The Next.js 13 `app` directory is not yet supported.) Consider the following `pages` directory:

```txt
pages
├── index.tsx
├── settings.tsx
├── blog
│   ├── [slug].tsx
│   └── index.tsx
└── [[...catchall]].tsx
```

The `FileSystemRouter` can be used to resolve routes against this directory:

```ts
const router = new Bun.FileSystemRouter({
  style: "nextjs",
  dir: "./pages",
  origin: "https://mydomain.com",
  assetPrefix: "_next/static/"
});
router.match("/");

// =>
{
  filePath: "/path/to/pages/index.tsx",
  kind: "exact",
  name: "/",
  pathname: "/",
  src: "https://mydomain.com/_next/static/pages/index.tsx"
}
```

Query parameters will be parsed and returned in the `query` property.

```ts
router.match("/settings?foo=bar");

// =>
{
  filePath: "/Users/colinmcd94/Documents/bun/fun/pages/settings.tsx",
  kind: "dynamic",
  name: "/settings",
  pathname: "/settings?foo=bar",
  src: "https://mydomain.com/_next/static/pages/settings.tsx",
  query: {
    foo: "bar"
  }
}
```

The router will automatically parse URL parameters and return them in the `params` property:

```ts
router.match("/blog/my-cool-post");

// =>
{
  filePath: "/Users/colinmcd94/Documents/bun/fun/pages/blog/[slug].tsx",
  kind: "dynamic",
  name: "/blog/[slug]",
  pathname: "/blog/my-cool-post",
  src: "https://mydomain.com/_next/static/pages/blog/[slug].tsx",
  params: {
    slug: "my-cool-post"
  }
}
```

The `.match()` method also accepts `Request` and `Response` objects. The `url` property will be used to resolve the route.

```ts
router.match(new Request("https://example.com/blog/my-cool-post"));
```

The router will read the directory contents on initialization. To re-scan the files, use the `.reload()` method.

```ts
router.reload();
```

## React Router-style

`FileSystemRouter` also understands React Router's file routing conventions. Pass `style: "react-router"` and point `dir` at the directory containing your `routes` files (commonly `app/routes`). Bun will infer the same URL structure as React Router, including pathless layouts, optional segments, and splat routes.

```txt
app/routes
├── _index.tsx
├── about.tsx
├── concerts._index.tsx
├── concerts.$city.tsx
├── concerts.trending.tsx
├── concerts_.mine.tsx
├── _auth.login.tsx
├── _auth.register.tsx
├── ($lang).categories.tsx
├── files.$.tsx
├── $.tsx
├── sitemap[.]xml.tsx
├── dashboard
│   └── route.tsx
└── dashboard.projects.tsx
```

```ts
const router = new Bun.FileSystemRouter({
  dir: "./app/routes",
  style: "react-router",
});

router.match("/concerts/salt-lake-city");
// => { name: "/concerts/:city", params: { city: "salt-lake-city" } }

router.match("/categories");
// => { name: "/:lang?/categories", params: {} }
```

Pathless layout files (prefixed with `_`) are ignored, optional segments created with parentheses are supported, and splat routes (`$.tsx`) capture the remainder of the path in the `*` parameter—matching the React Router documentation.

## Reference

```ts
interface Bun {
  class FileSystemRouter {
    constructor(params: {
      dir: string;
      style: "nextjs" | "react-router";
      origin?: string;
      assetPrefix?: string;
      fileExtensions?: string[];
    });

    reload(): void;

    match(path: string | Request | Response): {
      filePath: string;
      kind: "exact" | "catch-all" | "optional-catch-all" | "dynamic";
      name: string;
      pathname: string;
      src: string;
      params?: Record<string, string>;
      query?: Record<string, string>;
    } | null
  }
}
```
