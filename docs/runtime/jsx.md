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

Bun implements special logging for JSX to make debugging easier.

```bash
$ bun run react.tsx
<Component message="Hello world!" />
```

<!-- ### Prop punning

The Bun runtime also supports "prop punning" for JSX. This is a shorthand syntax useful for assigning a variable to a prop with the same name.

```tsx
function Div(props: {className: string;}) {
  const {className} = props;

  // without punning
  return <div className={className} />;
  // with punning
  return <div {className} />;
}
``` -->
