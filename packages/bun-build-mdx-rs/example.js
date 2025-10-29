#!/usr/bin/env bun

// Example: Using bun-mdx-rs
// Run with: bun example.js

const { compile, compileWithPlugins } = require("./index.js");

const sampleMdx = `---
title: "Getting Started"
author: "Jane Doe"
date: 2024-10-29
---

# Getting Started with bun-mdx-rs

This is **blazingly fast** MDX compilation using Rust!

## Features

- ~~Slow compilation~~ → **7x faster!**
- GitHub Flavored Markdown
- Frontmatter support
- Optional plugins

## Code Example

\`\`\`javascript
import { compile } from 'bun-mdx-rs';

const result = await compile(source);
console.log(result.code);
\`\`\`

## Comparison Table

| Parser | Speed | Plugins |
|--------|-------|---------|
| @mdx-js/mdx | 1x | ✅ |
| bun-mdx-rs | 7x | ✅ |

## Task List

- [x] Fast parsing
- [x] GFM support
- [ ] Even faster!

Check out https://bun.sh for more info!
`;

console.log("═══════════════════════════════════════════════");
console.log("  bun-mdx-rs Example");
console.log("═══════════════════════════════════════════════\n");

// Example 1: Fast path (no plugins)
console.log("📝 Example 1: Fast Path (No Plugins)\n");

async function example1() {
  const start = performance.now();

  const result = await compile(sampleMdx, {
    gfm: true,
    frontmatter: true,
    math: false,
  });

  const end = performance.now();

  console.log("✅ Compiled successfully!");
  console.log(`⏱️  Time: ${(end - start).toFixed(2)}ms`);
  console.log(`📏 Output size: ${result.code.length} bytes\n`);
  console.log("Output (first 500 chars):");
  console.log(result.code.substring(0, 500) + "...\n");
}

await example1();

console.log("═══════════════════════════════════════════════\n");
console.log("📝 Example 2: Hybrid Mode (With Plugins)\n");

async function example2() {
  console.log("⚠️  Plugin support is a work in progress!");
  console.log("For now, use the fast path for maximum speed.\n");

  // This would be the API:
  // const result = await compileWithPlugins(sampleMdx, {
  //   remarkPlugins: [remarkMdxFrontmatter],
  //   rehypePlugins: [rehypeHighlight],
  // });
}

await example2();

console.log("═══════════════════════════════════════════════\n");
console.log("💡 Try building this yourself:\n");
console.log("  cd packages/bun-build-mdx-rs");
console.log("  bun run build");
console.log("  bun example.js\n");
console.log("═══════════════════════════════════════════════\n");
