type Inspect = typeof import("util").inspect;

// This is passed to [util.inspect.custom](..., { stylize }) to help users colorize parts.
export function getStylizeWithColor(inspect: Inspect) {
  return function stylizeWithColor(str: string, styleType: string) {
    const style = inspect.styles[styleType];
    if (style !== undefined) {
      const color = inspect.colors[style];
      if (color !== undefined) return `\u001b[${color[0]}m${str}\u001b[${color[1]}m`;
    }
    return str;
  };
}

export function stylizeWithNoColor(str: string) {
  return str;
}
