declare module "supports-color" {
  export interface Options {
    /**
    Whether `process.argv` should be sniffed for `--color` and `--no-color` flags.
    @default true
    */
    readonly sniffFlags?: boolean;
  }

  /**
  Levels:
  - `0` - All colors disabled.
  - `1` - Basic 16 colors support.
  - `2` - ANSI 256 colors support.
  - `3` - Truecolor 16 million colors support.
  */
  export type ColorSupportLevel = 0 | 1 | 2 | 3;

  /**
  Detect whether the terminal supports color.
  */
  export interface ColorSupport {
    /**
    The color level.
    */
    level: ColorSupportLevel;

    /**
    Whether basic 16 colors are supported.
    */
    hasBasic: boolean;

    /**
    Whether ANSI 256 colors are supported.
    */
    has256: boolean;

    /**
    Whether Truecolor 16 million colors are supported.
    */
    has16m: boolean;
  }

  export type ColorInfo = ColorSupport | false;

  export const supportsColor: {
    stdout: ColorInfo;
    stderr: ColorInfo;
  };

  export const stdout: ColorInfo;
  export const stderr: ColorInfo;

  export default supportsColor;
}
