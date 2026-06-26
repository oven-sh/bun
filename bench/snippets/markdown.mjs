import { marked } from "marked";
import { remark } from "remark";
import remarkHtml from "remark-html";
import { bench, run, summary } from "../runner.mjs";

const remarkProcessor = remark().use(remarkHtml);

const small = `# Hello World

This is a **bold** and *italic* paragraph with a [link](https://example.com).

- Item 1
- Item 2
- Item 3
`;

const medium = `# Project README

## Introduction

This is a medium-sized markdown document that includes **bold text**, *italic text*,
and \`inline code\`. It also has [links](https://example.com) and various formatting.

## Features

- Feature one with **bold**
- Feature two with *emphasis*
- Feature three with \`code\`
- Feature four with [a link](https://example.com)

## Code Example

\`\`\`javascript
function hello() {
  console.log("Hello, world!");
  return 42;
}

const result = hello();
\`\`\`

## Table

| Name | Value | Description |
|------|-------|-------------|
| foo  | 1     | First item  |
| bar  | 2     | Second item |
| baz  | 3     | Third item  |

## Blockquote

> This is a blockquote with **bold** and *italic* text.
> It spans multiple lines and contains a [link](https://example.com).

---

### Nested Lists

1. First ordered item
   - Nested unordered
   - Another nested
2. Second ordered item
   1. Nested ordered
   2. Another nested
3. Third ordered item

Some final paragraph with ~~strikethrough~~ text and more **formatting**.
`;

const large = medium.repeat(20);

const renderCallbacks = {
  heading: (children, { level }) => `<h${level}>${children}</h${level}>`,
  paragraph: children => `<p>${children}</p>`,
  strong: children => `<strong>${children}</strong>`,
  emphasis: children => `<em>${children}</em>`,
  codespan: children => `<code>${children}</code>`,
  code: (children, { language }) =>
    language
      ? `<pre><code class="language-${language}">${children}</code></pre>`
      : `<pre><code>${children}</code></pre>`,
  link: (children, { href, title }) =>
    title ? `<a href="${href}" title="${title}">${children}</a>` : `<a href="${href}">${children}</a>`,
  image: (children, { src, title }) =>
    title ? `<img src="${src}" alt="${children}" title="${title}" />` : `<img src="${src}" alt="${children}" />`,
  list: (children, { ordered, start }) => (ordered ? `<ol start="${start}">${children}</ol>` : `<ul>${children}</ul>`),
  listItem: children => `<li>${children}</li>`,
  blockquote: children => `<blockquote>${children}</blockquote>`,
  hr: () => `<hr />`,
  strikethrough: children => `<del>${children}</del>`,
  table: children => `<table>${children}</table>`,
  thead: children => `<thead>${children}</thead>`,
  tbody: children => `<tbody>${children}</tbody>`,
  tr: children => `<tr>${children}</tr>`,
  th: children => `<th>${children}</th>`,
  td: children => `<td>${children}</td>`,
};

summary(() => {
  if (typeof Bun !== "undefined" && Bun.markdown) {
    bench(`small (${small.length} chars) - Bun.markdown.html`, () => {
      return Bun.markdown.html(small);
    });

    bench(`small (${small.length} chars) - Bun.markdown.render`, () => {
      return Bun.markdown.render(small, renderCallbacks);
    });

    bench(`small (${small.length} chars) - Bun.markdown.react`, () => {
      return Bun.markdown.react(small);
    });
  }

  bench(`small (${small.length} chars) - marked`, () => {
    return marked(small);
  });

  bench(`small (${small.length} chars) - remark`, () => {
    return remarkProcessor.processSync(small).toString();
  });
});

summary(() => {
  if (typeof Bun !== "undefined" && Bun.markdown) {
    bench(`medium (${medium.length} chars) - Bun.markdown.html`, () => {
      return Bun.markdown.html(medium);
    });

    bench(`medium (${medium.length} chars) - Bun.markdown.render`, () => {
      return Bun.markdown.render(medium, renderCallbacks);
    });

    bench(`medium (${medium.length} chars) - Bun.markdown.react`, () => {
      return Bun.markdown.react(medium);
    });
  }

  bench(`medium (${medium.length} chars) - marked`, () => {
    return marked(medium);
  });

  bench(`medium (${medium.length} chars) - remark`, () => {
    return remarkProcessor.processSync(medium).toString();
  });
});

summary(() => {
  if (typeof Bun !== "undefined" && Bun.markdown) {
    bench(`large (${large.length} chars) - Bun.markdown.html`, () => {
      return Bun.markdown.html(large);
    });

    bench(`large (${large.length} chars) - Bun.markdown.render`, () => {
      return Bun.markdown.render(large, renderCallbacks);
    });

    bench(`large (${large.length} chars) - Bun.markdown.react`, () => {
      return Bun.markdown.react(large);
    });
  }

  bench(`large (${large.length} chars) - marked`, () => {
    return marked(large);
  });

  bench(`large (${large.length} chars) - remark`, () => {
    return remarkProcessor.processSync(large).toString();
  });
});

await run();
