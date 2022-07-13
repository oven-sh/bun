### CSS runtime

To support hot CSS reloading, bun inserts `@supports` annotations into CSS that tag which files a stylesheet is composed of. Browsers ignore this, so it doesn’t impact styles.

By default, bun’s runtime code automatically listens to `onimportcss` and will insert the `event.detail` into a `<link rel="stylesheet" href={${event.detail}}>` if there is no existing `link` tag with that stylesheet. That’s how bun’s equivalent of `style-loader` works.
