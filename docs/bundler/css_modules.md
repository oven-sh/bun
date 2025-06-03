# CSS Modules

Bun's bundler also supports bundling [CSS modules](https://css-tricks.com/css-modules-part-1-need/) in addition to [regular CSS](/docs/bundler/css) with support for the following features:

- Automatically detecting CSS module files (`.module.css`) with zero configuration
- Composition (`composes` property)
- Importing CSS modules into JSX/TSX
- Warnings/errors for invalid usages of CSS modules

A CSS module is a CSS file (with the `.module.css` extension) where are all class names and animations are scoped to the file. This helps you avoid class name collisions as CSS declarations are globally scoped by default.

Under the hood, Bun's bundler transforms locally scoped class names into unique identifiers.

## Getting started

Create a CSS file with the `.module.css` extension:

```css
/* styles.module.css */
.button {
  color: red;
}

/* other-styles.module.css */
.button {
  color: blue;
}
```

You can then import this file, for example into a TSX file:

```tsx
import styles from "./styles.module.css";
import otherStyles from "./other-styles.module.css";

export default function App() {
  return (
    <>
      <button className={styles.button}>Red button!</button>
      <button className={otherStyles.button}>Blue button!</button>
    </>
  );
}
```

The `styles` object from importing the CSS module file will be an object with all class names as keys and
their unique identifiers as values:

```tsx
import styles from "./styles.module.css";
import otherStyles from "./other-styles.module.css";

console.log(styles);
console.log(otherStyles);
```

This will output:

```ts
{
  button: "button_123";
}

{
  button: "button_456";
}
```

As you can see, the class names are unique to each file, avoiding any collisions!

### Composition

CSS modules allow you to _compose_ class selectors together. This lets you reuse style rules across multiple classes.

For example:

```css
/* styles.module.css */
.button {
  composes: background;
  color: red;
}

.background {
  background-color: blue;
}
```

Would be the same as writing:

```css
.button {
  background-color: blue;
  color: red;
}

.background {
  background-color: blue;
}
```

{% callout %}
There are a couple rules to keep in mind when using `composes`:

- A `composes` property must come before any regular CSS properties or declarations
- You can only use `composes` on a **simple selector with a single class name**:

```css
#button {
  /* Invalid! `#button` is not a class selector */
  composes: background;
}

.button,
.button-secondary {
  /* Invalid! `.button, .button-secondary` is not a simple selector */
  composes: background;
}
```

{% /callout %}

### Composing from a separate CSS module file

You can also compose from a separate CSS module file:

```css
/* background.module.css */
.background {
  background-color: blue;
}

/* styles.module.css */
.button {
  composes: background from "./background.module.css";
  color: red;
}
```

{% callout %}
When composing classes from separate files, be sure that they do not contain the same properties.

The CSS module spec says that composing classes from separate files with conflicting properties is
undefined behavior, meaning that the output may differ and be unreliable.
{% /callout %}
