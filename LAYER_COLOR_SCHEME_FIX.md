# Fix for @layer color-scheme Bug

## Issue Description

When using `color-scheme` properties within `@layer` blocks, Bun's CSS parser was not correctly injecting the required `--buncss-light` and `--buncss-dark` CSS variables within the layer context. Instead, the variables were being injected at the top level, breaking the cascade layer ordering.

### Example of the Bug

**Input:**
```css
@layer shm.colors {
  body.theme-dark {
    color-scheme: dark;
  }

  body.theme-light {
    color-scheme: light;
  }
}
```

**Incorrect Output (before fix):**
```css
@layer shm.colors {
  body.theme-dark {
    color-scheme: dark;
  }

  body.theme-light {
    color-scheme: light;
  }
}
```

**Expected Output (after fix):**
```css
@layer shm.colors {
  body.theme-dark {
    --buncss-light: ;
    --buncss-dark: initial;
    color-scheme: dark;
  }

  body.theme-light {
    --buncss-light: initial;
    --buncss-dark: ;
    color-scheme: light;
  }
}
```

## Root Cause

The issue was caused by two problems:

1. **Missing Layer Block Processing**: The `LayerBlockRule` minification was not implemented, marked as "TODO" in `src/css/rules/rules.zig`.

2. **No Layer Context Tracking**: The `PropertyHandlerContext` didn't track which layer context it was operating in, so when additional rules (like dark theme media queries) were generated, they were created without layer context.

## Solution

### 1. Implemented LayerBlockRule.minify()

Added a proper `minify` method to `LayerBlockRule` in `src/css/rules/layer.zig`:

```zig
pub fn minify(this: *This, context: *css.MinifyContext, parent_is_unused: bool) css.MinifyErr!bool {
    // Save the current layer context
    const saved_layer_name = context.handler_context.layer_name;
    
    // Set the layer context for rules within this layer
    context.handler_context.setLayerContext(this.name);
    
    // Minify the rules within the layer
    try this.rules.minify(context, parent_is_unused);
    
    // Restore the previous layer context
    context.handler_context.layer_name = saved_layer_name;
    
    return this.rules.v.items.len == 0;
}
```

### 2. Added Layer Context Tracking

Enhanced `PropertyHandlerContext` in `src/css/context.zig`:

- Added `layer_name: ?css.css_rules.layer.LayerName` field
- Added `setLayerContext()` method
- Updated `new()` and `child()` methods to handle layer context

### 3. Modified Additional Rules Generation

Updated `getAdditionalRules()` method to wrap generated media queries in layer blocks when a layer context exists:

```zig
// If we have a layer context, wrap the media rule in a layer block
if (this.layer_name) |layer_name| {
    dest.append(this.allocator, css.CssRule(T){
        .layer_block = css.css_rules.layer.LayerBlockRule(T){
            .name = layer_name.deepClone(this.allocator),
            .rules = css.CssRuleList(T){
                .v = brk: {
                    var list = ArrayList(css.CssRule(T)).initCapacity(this.allocator, 1) catch bun.outOfMemory();
                    list.appendAssumeCapacity(media_rule);
                    break :brk list;
                },
            },
            .loc = style_rule.loc,
        },
    }) catch bun.outOfMemory();
} else {
    dest.append(this.allocator, media_rule) catch bun.outOfMemory();
}
```

### 4. Updated Layer Block Processing

Modified the layer block handling in `src/css/rules/rules.zig` to actually call the minify method:

```zig
.layer_block => |*lay| {
    if (try lay.minify(context, parent_is_unused)) {
        continue;
    }
},
```

## Files Modified

1. `src/css/rules/layer.zig` - Added `minify` method to `LayerBlockRule`
2. `src/css/context.zig` - Added layer context tracking to `PropertyHandlerContext`
3. `src/css/rules/rules.zig` - Updated layer block processing
4. `test/js/bun/css/css.test.ts` - Added test case for the bug
5. `test/regression/issue/layer-color-scheme.test.ts` - Added comprehensive regression tests

## Testing

The fix includes comprehensive tests that verify:

1. CSS variables are injected within the correct layer context
2. Media queries for dark themes are also wrapped in the appropriate layer
3. Normal color-scheme behavior without layers continues to work
4. Nested layer contexts are handled correctly

## Impact

This fix ensures that CSS cascade layers work correctly with Bun's color-scheme processing, maintaining proper cascade ordering and preventing style conflicts that could occur when variables are injected at the wrong layer level.