Bun supports `.jsx` and `.tsx` files out of the box. Bun's internal transpiler converts JSX syntax into vanilla JavaScript before execution.

```tsx#react.tsx
function Component(props: {message: string}) {
  return (
    <body>
      <h1 style={{color: 'red'}}>{props.message}</h1>
    </body>
  );
}

console.log(<Component message="Hello world!" />);
```

## Configuration

Bun reads your `tsconfig.json` or `jsconfig.json` configuration files to determines how to perform the JSX transform internally. To avoid using either of these, the following options can also be defined in [`bunfig.toml`](https://bun.com/docs/runtime/bunfig).

The following compiler options are respected.

### [`jsx`](https://www.typescriptlang.org/tsconfig#jsx)

How JSX constructs are transformed into vanilla JavaScript internally. The table below lists the possible values of `jsx`, along with their transpilation of the following simple JSX component:

```tsx
<Box width={5}>Hello</Box>
```

{% table %}

- Compiler options
- Transpiled output

---

- ```json
  {
    "jsx": "react"
  }
  ```

- ```tsx
  import { createElement } from "react";
  createElement("Box", { width: 5 }, "Hello");
  ```

---

- ```json
  {
    "jsx": "react-jsx"
  }
  ```

- ```tsx
  import { jsx } from "react/jsx-runtime";
  jsx("Box", { width: 5 }, "Hello");
  ```

---

- ```json
  {
    "jsx": "react-jsxdev"
  }
  ```

- ```tsx
  import { jsxDEV } from "react/jsx-dev-runtime";
  jsxDEV(
    "Box",
    { width: 5, children: "Hello" },
    undefined,
    false,
    undefined,
    this,
  );
  ```

  The `jsxDEV` variable name is a convention used by React. The `DEV` suffix is a visible way to indicate that the code is intended for use in development. The development version of React is slower and includes additional validity checks & debugging tools.

---

- ```json
  {
    "jsx": "preserve"
  }
  ```

- ```tsx
  // JSX is not transpiled
  // "preserve" is not supported by Bun currently
  <Box width={5}>Hello</Box>
  ```

{% /table %}

<!-- {% table %}

- `react`
- `React.createElement("Box", {width: 5}, "Hello")`

---

- `react-jsx`
- `jsx("Box", {width: 5}, "Hello")`

---

- `react-jsxdev`
- `jsxDEV("Box", {width: 5}, "Hello", void 0, false)`

---

- `preserve`
- `<Box width={5}>Hello</Box>` Left as-is; not yet supported by Bun.

{% /table %} -->

### [`jsxFactory`](https://www.typescriptlang.org/tsconfig#jsxFactory)

{% callout %}
**Note** — Only applicable when `jsx` is `react`.
{% /callout %}

The function name used to represent JSX constructs. Default value is `"createElement"`. This is useful for libraries like [Preact](https://preactjs.com/) that use a different function name (`"h"`).

{% table %}

- Compiler options
- Transpiled output

---

- ```json
  {
    "jsx": "react",
    "jsxFactory": "h"
  }
  ```

- ```tsx
  import { h } from "react";
  h("Box", { width: 5 }, "Hello");
  ```

{% /table %}

### [`jsxFragmentFactory`](https://www.typescriptlang.org/tsconfig#jsxFragmentFactory)

{% callout %}
**Note** — Only applicable when `jsx` is `react`.
{% /callout %}

The function name used to represent [JSX fragments](https://react.dev/reference/react/Fragment) such as `<>Hello</>`; only applicable when `jsx` is `react`. Default value is `"Fragment"`.

{% table %}

- Compiler options
- Transpiled output

---

- ```json
  {
    "jsx": "react",
    "jsxFactory": "myjsx",
    "jsxFragmentFactory": "MyFragment"
  }
  ```

- ```tsx
  // input
  <>Hello</>;

  // output
  import { myjsx, MyFragment } from "react";
  myjsx(MyFragment, null, "Hello");
  ```

{% /table %}

### [`jsxImportSource`](https://www.typescriptlang.org/tsconfig#jsxImportSource)

{% callout %}
**Note** — Only applicable when `jsx` is `react-jsx` or `react-jsxdev`.
{% /callout %}

The module from which the component factory function (`createElement`, `jsx`, `jsxDEV`, etc) will be imported. Default value is `"react"`. This will typically be necessary when using a component library like Preact.

{% table %}

- Compiler options
- Transpiled output

---

- ```jsonc
  {
    "jsx": "react",
    // jsxImportSource is not defined
    // default to "react"
  }
  ```

- ```tsx
  import { jsx } from "react/jsx-runtime";
  jsx("Box", { width: 5, children: "Hello" });
  ```

---

- ```jsonc
  {
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
  }
  ```

- ```tsx
  import { jsx } from "preact/jsx-runtime";
  jsx("Box", { width: 5, children: "Hello" });
  ```

---

- ```jsonc
  {
    "jsx": "react-jsxdev",
    "jsxImportSource": "preact",
  }
  ```

- ```tsx
  // /jsx-runtime is automatically appended
  import { jsxDEV } from "preact/jsx-dev-runtime";
  jsxDEV(
    "Box",
    { width: 5, children: "Hello" },
    undefined,
    false,
    undefined,
    this,
  );
  ```

{% /table %}

### `jsxSideEffects`

By default, Bun marks JSX expressions as `/* @__PURE__ */` so they can be removed during bundling if they are unused (known as "dead code elimination" or "tree shaking"). Set `jsxSideEffects` to `true` to prevent this behavior.

{% table %}

- Compiler options
- Transpiled output

---

- ```jsonc
  {
    "jsx": "react",
    // jsxSideEffects is false by default
  }
  ```

- ```tsx
  // JSX expressions are marked as pure
  /* @__PURE__ */ React.createElement("div", null, "Hello");
  ```

---

- ```jsonc
  {
    "jsx": "react",
    "jsxSideEffects": true,
  }
  ```

- ```tsx
  // JSX expressions are not marked as pure
  React.createElement("div", null, "Hello");
  ```

---

- ```jsonc
  {
    "jsx": "react-jsx",
    "jsxSideEffects": true,
  }
  ```

- ```tsx
  // Automatic runtime also respects jsxSideEffects
  jsx("div", { children: "Hello" });
  ```

{% /table %}

This option is also available as a CLI flag:

```bash
$ bun build --jsx-side-effects
```

### JSX pragma

All of these values can be set on a per-file basis using _pragmas_. A pragma is a special comment that sets a compiler option in a particular file.

{% table %}

- Pragma
- Equivalent config

---

- ```ts
  // @jsx h
  ```

- ```jsonc
  {
    "jsxFactory": "h",
  }
  ```

---

- ```ts
  // @jsxFrag MyFragment
  ```
- ```jsonc
  {
    "jsxFragmentFactory": "MyFragment",
  }
  ```

---

- ```ts
  // @jsxImportSource preact
  ```
- ```jsonc
  {
    "jsxImportSource": "preact",
  }
  ```

{% /table %}

## Logging

Bun implements special logging for JSX to make debugging easier. Given the following file:

```tsx#index.tsx
import { Stack, UserCard } from "./components";

console.log(
  <Stack>
    <UserCard name="Dom" bio="Street racer and Corona lover" />
    <UserCard name="Jakob" bio="Super spy and Dom's secret brother" />
  </Stack>
);
```

Bun will pretty-print the component tree when logged:

{% image src="https://github.com/oven-sh/bun/assets/3084745/d29db51d-6837-44e2-b8be-84fc1b9e9d97" / %}

## Prop punning

The Bun runtime also supports "prop punning" for JSX. This is a shorthand syntax useful for assigning a variable to a prop with the same name.

```tsx
function Div(props: {className: string;}) {
  const {className} = props;

  // without punning
  return <div className={className} />;
  // with punning
  return <div {className} />;
}
```
