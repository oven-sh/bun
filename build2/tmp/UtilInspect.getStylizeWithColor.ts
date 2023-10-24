// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/UtilInspect.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(inspect) {  return function stylizeWithColor(str: string, styleType: string) {
    const style = inspect.styles[styleType];
    if (style !== undefined) {
      const color = inspect.colors[style];
      if (color !== undefined) return `\u001b[${color[0]}m${str}\u001b[${color[1]}m`;
    }
    return str;
  };
}).$$capture_end$$;
