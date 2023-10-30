// Copied from: https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/pkgjs__parseargs/index.d.ts?q=repo%3ADefinitelyTyped%2FDefinitelyTyped%20parseArgs&type=code
/**
 * Provides a high-level API for command-line argument parsing. Takes a
 * specification for the expected arguments and returns a structured object
 * with the parsed values and positionals.
 *
 * `config` provides arguments for parsing and configures the parser. It
 * supports the following properties:
 *
 *   - `args` The array of argument strings. **Default:** `process.argv` with
 *     `execPath` and `filename` removed.
 *   - `options` Arguments known to the parser. Keys of `options` are the long
 *     names of options and values are objects accepting the following properties:
 *
 *     - `type` Type of argument, which must be either `boolean` (for options
 *        which do not take values) or `string` (for options which do).
 *     - `multiple` Whether this option can be provided multiple
 *       times. If `true`, all values will be collected in an array. If
 *       `false`, values for the option are last-wins. **Default:** `false`.
 *     - `short` A single character alias for the option.
 *
 *   - `strict`: Whether an error should be thrown when unknown arguments
 *     are encountered, or when arguments are passed that do not match the
 *     `type` configured in `options`. **Default:** `true`.
 *   - `allowPositionals`: Whether this command accepts positional arguments.
 *     **Default:** `false` if `strict` is `true`, otherwise `true`.
 *   - `tokens`: Whether tokens {boolean} Return the parsed tokens. This is useful
 *     for extending the built-in behavior, from adding additional checks through
 *     to reprocessing the tokens in different ways.
 *     **Default:** `false`.
 *
 * @returns The parsed command line arguments:
 *
 *   - `values` A mapping of parsed option names with their string
 *     or boolean values.
 *   - `positionals` Positional arguments.
 *   - `tokens` Detailed parse information (only if `tokens` was specified).
 */
export function parseArgs<T extends ParseArgsConfig>(config: T): ParsedResults<T>;

interface ParseArgsOptionConfig {
  type: "string" | "boolean";
  short?: string;
  multiple?: boolean;
}

interface ParseArgsOptionsConfig {
  [longOption: string]: ParseArgsOptionConfig;
}

export interface ParseArgsConfig {
  strict?: boolean;
  allowPositionals?: boolean;
  tokens?: boolean;
  options?: ParseArgsOptionsConfig;
  args?: string[];
}

/*
IfDefaultsTrue and IfDefaultsFalse are helpers to handle default values for missing boolean properties.
TypeScript does not have exact types for objects: https://github.com/microsoft/TypeScript/issues/12936
This means it is impossible to distinguish between "field X is definitely not present" and "field X may or may not be present".
But we expect users to generally provide their config inline or `as const`, which means TS will always know whether a given field is present.
So this helper treats "not definitely present" (i.e., not `extends boolean`) as being "definitely not present", i.e. it should have its default value.
This is technically incorrect but is a much nicer UX for the common case.
The IfDefaultsTrue version is for things which default to true; the IfDefaultsFalse version is for things which default to false.
*/
type IfDefaultsTrue<T, IfTrue, IfFalse> = T extends true ? IfTrue : T extends false ? IfFalse : IfTrue;

// we put the `extends false` condition first here because `undefined` compares like `any` when `strictNullChecks: false`
type IfDefaultsFalse<T, IfTrue, IfFalse> = T extends false ? IfFalse : T extends true ? IfTrue : IfFalse;

type ExtractOptionValue<T extends ParseArgsConfig, O extends ParseArgsOptionConfig> = IfDefaultsTrue<
  T["strict"],
  O["type"] extends "string" ? string : O["type"] extends "boolean" ? boolean : string | boolean,
  string | boolean
>;

type ParsedValues<T extends ParseArgsConfig> = IfDefaultsTrue<
  T["strict"],
  unknown,
  { [longOption: string]: undefined | string | boolean }
> &
  (T["options"] extends ParseArgsOptionsConfig
    ? {
        -readonly [LongOption in keyof T["options"]]: IfDefaultsFalse<
          T["options"][LongOption]["multiple"],
          undefined | Array<ExtractOptionValue<T, T["options"][LongOption]>>,
          undefined | ExtractOptionValue<T, T["options"][LongOption]>
        >;
      }
    : {});

type ParsedPositionals<T extends ParseArgsConfig> = IfDefaultsTrue<
  T["strict"],
  IfDefaultsFalse<T["allowPositionals"], string[], []>,
  IfDefaultsTrue<T["allowPositionals"], string[], []>
>;

type PreciseTokenForOptions<K extends string, O extends ParseArgsOptionConfig> = O["type"] extends "string"
  ? {
      kind: "option";
      index: number;
      name: K;
      rawName: string;
      value: string;
      inlineValue: boolean;
    }
  : O["type"] extends "boolean"
  ? {
      kind: "option";
      index: number;
      name: K;
      rawName: string;
      value: undefined;
      inlineValue: undefined;
    }
  : OptionToken & { name: K };

type TokenForOptions<T extends ParseArgsConfig, K extends keyof T["options"] = keyof T["options"]> = K extends unknown
  ? T["options"] extends ParseArgsOptionsConfig
    ? PreciseTokenForOptions<K & string, T["options"][K]>
    : OptionToken
  : never;

type ParsedOptionToken<T extends ParseArgsConfig> = IfDefaultsTrue<T["strict"], TokenForOptions<T>, OptionToken>;

type ParsedPositionalToken<T extends ParseArgsConfig> = IfDefaultsTrue<
  T["strict"],
  IfDefaultsFalse<T["allowPositionals"], { kind: "positional"; index: number; value: string }, never>,
  IfDefaultsTrue<T["allowPositionals"], { kind: "positional"; index: number; value: string }, never>
>;

type ParsedTokens<T extends ParseArgsConfig> = Array<
  ParsedOptionToken<T> | ParsedPositionalToken<T> | { kind: "option-terminator"; index: number }
>;

type PreciseParsedResults<T extends ParseArgsConfig> = IfDefaultsFalse<
  T["tokens"],
  {
    values: ParsedValues<T>;
    positionals: ParsedPositionals<T>;
    tokens: ParsedTokens<T>;
  },
  {
    values: ParsedValues<T>;
    positionals: ParsedPositionals<T>;
  }
>;

type OptionToken =
  | { kind: "option"; index: number; name: string; rawName: string; value: string; inlineValue: boolean }
  | {
      kind: "option";
      index: number;
      name: string;
      rawName: string;
      value: undefined;
      inlineValue: undefined;
    };

type Token =
  | OptionToken
  | { kind: "positional"; index: number; value: string }
  | { kind: "option-terminator"; index: number };

// If ParseArgsConfig extends T, then the user passed config constructed elsewhere.
// So we can't rely on the `"not definitely present" implies "definitely not present"` assumption mentioned above.
type ParsedResults<T extends ParseArgsConfig> = ParseArgsConfig extends T
  ? {
      values: { [longOption: string]: undefined | string | boolean | Array<string | boolean> };
      positionals: string[];
      tokens?: Token[];
    }
  : PreciseParsedResults<T>;

export {};
