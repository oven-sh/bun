# Wildcard sideEffects Support in Bun

This document describes Bun's support for glob patterns in the `sideEffects` field of `package.json`, which enables more flexible tree-shaking optimization.

## Overview

The `sideEffects` field in `package.json` tells bundlers which files can be safely removed during tree-shaking if they are not imported. Bun now supports glob patterns in addition to exact file paths, allowing developers to specify complex patterns for files with side effects.

## Supported Glob Patterns

Bun supports all standard glob patterns:

### Basic Patterns

- **`*`** - Matches zero or more characters within a path segment
  ```json
  {
    "sideEffects": ["src/effects/*.js"]
  }
  ```

- **`?`** - Matches any single character
  ```json
  {
    "sideEffects": ["src/file?.js"]
  }
  ```

### Character Classes

- **`[abc]`** - Matches any character in the set
  ```json
  {
    "sideEffects": ["src/file[123].js"]
  }
  ```

- **`[a-z]`** - Matches any character in the range
  ```json
  {
    "sideEffects": ["src/file[a-z].js"]
  }
  ```

### Brace Expansion

- **`{a,b}`** - Matches either pattern a or b
  ```json
  {
    "sideEffects": ["src/{components,utils}/*.js"]
  }
  ```

### Globstar

- **`**`** - Matches zero or more path segments
  ```json
  {
    "sideEffects": ["src/**/effects/*.js"]
  }
  ```

## Mixed Patterns

You can combine exact file paths with glob patterns in the same array:

```json
{
  "sideEffects": [
    "src/polyfills.js",
    "src/effects/*.js",
    "src/{components,utils}/**/*.css"
  ]
}
```

## Examples

### Basic Usage

```json
{
  "name": "my-package",
  "sideEffects": ["src/side-effects/*.js"]
}
```

This preserves side effects for all JavaScript files in the `src/side-effects/` directory.

### Multiple Directories

```json
{
  "sideEffects": ["src/{polyfills,effects}/*.js"]
}
```

This preserves side effects for JavaScript files in both `src/polyfills/` and `src/effects/` directories.

### Deep Matching

```json
{
  "sideEffects": ["src/**/side-effects/**/*.js"]
}
```

This preserves side effects for JavaScript files in any `side-effects` directory at any depth under `src/`.

### File Extensions

```json
{
  "sideEffects": ["src/effects/*.{js,ts,jsx,tsx}"]
}
```

This preserves side effects for JavaScript and TypeScript files with any of the specified extensions.

### Mixed Exact and Glob Patterns

```json
{
  "sideEffects": [
    "src/polyfill.js",
    "src/global-setup.js",
    "src/effects/*.js",
    "src/components/**/*.css"
  ]
}
```

This combines exact file paths with glob patterns for maximum flexibility.

## Implementation Details

### Performance Optimizations

Bun optimizes sideEffects processing based on the pattern types:

- **Exact matches only**: Uses a hash map for O(1) lookup performance
- **Glob patterns only**: Uses Bun's glob matcher with pattern array
- **Mixed patterns**: Uses both approaches for optimal performance

### CSS File Handling

CSS files in glob patterns are automatically ignored for tree-shaking purposes, as they typically don't contain executable JavaScript side effects.

### Error Handling

- Invalid glob patterns are gracefully handled and don't crash the bundler
- Malformed patterns fall back to treating all files as having side effects
- The bundler continues processing even with problematic patterns

## Migration from Previous Versions

### Before (Bun < 1.3.0)

```json
{
  "sideEffects": ["src/effects/file1.js", "src/effects/file2.js", "src/effects/file3.js"]
}
```

This required listing every file individually and would show a warning for any wildcard patterns.

### After (Bun >= 1.3.0)

```json
{
  "sideEffects": ["src/effects/*.js"]
}
```

This accomplishes the same result with a single glob pattern and no warnings.

## Cross-Platform Compatibility

### Path Separators

Always use forward slashes (`/`) in glob patterns, even on Windows:

```json
// ✅ Correct - works on all platforms
{
  "sideEffects": ["src/effects/*.js"]
}

// ❌ Avoid - Windows-specific backslashes
{
  "sideEffects": ["src\\effects\\*.js"]
}
```

Bun automatically handles path normalization internally, so forward slashes in patterns will correctly match Windows paths with backslashes.

## Best Practices

### 1. Use Specific Patterns

Prefer specific patterns over broad ones to maintain optimal tree-shaking:

```json
// Good - specific directory
{
  "sideEffects": ["src/polyfills/*.js"]
}

// Avoid - too broad
{
  "sideEffects": ["src/**/*.js"]
}
```

### 2. Combine Patterns Efficiently

Group related patterns using brace expansion:

```json
// Good
{
  "sideEffects": ["src/{polyfills,effects,setup}/*.js"]
}

// Less efficient
{
  "sideEffects": [
    "src/polyfills/*.js",
    "src/effects/*.js", 
    "src/setup/*.js"
  ]
}
```

### 3. Use Appropriate Extensions

Be specific about file extensions to avoid unintended matches:

```json
// Good - specific extensions
{
  "sideEffects": ["src/effects/*.{js,ts}"]
}

// Avoid - might match unwanted files
{
  "sideEffects": ["src/effects/*"]
}
```

## Troubleshooting

### Pattern Not Matching

If your glob pattern isn't matching expected files:

1. Check the pattern syntax
2. Verify the paths are relative to the package.json location
3. Test the pattern using Bun's glob matcher or similar tools
4. Ensure file extensions are included in the pattern

### Build Performance

If you notice slower build times:

1. Use more specific patterns instead of broad wildcards
2. Prefer exact paths for single files
3. Combine related patterns using brace expansion
4. Avoid deeply nested globstar patterns when possible

### Debugging

To debug sideEffects processing:

1. Use `bun build --verbose` to see detailed bundling information
2. Check the bundle output to verify which files were included/excluded
3. Test with exact file paths first, then replace with glob patterns

## Compatibility

- **Minimum Bun version**: 1.3.0+
- **Webpack compatibility**: Glob patterns follow standard glob syntax compatible with webpack
- **Node.js compatibility**: Works with any Node.js package manager that respects sideEffects

## Related

- [Tree Shaking Documentation](./tree-shaking.md)
- [Bundle Optimization Guide](./optimization.md)
- [Package.json Configuration](./package-json.md)