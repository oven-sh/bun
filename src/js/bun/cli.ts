// Bun CLI Parser and Interactive System

export interface ParseOptions {
  /**
   * Stop parsing at the first non-flag argument
   */
  stopEarly?: boolean;

  /**
   * Allow unknown flags (default: true)
   */
  allowUnknown?: boolean;

  /**
   * Automatically convert string values to numbers/booleans (default: true)
   */
  autoType?: boolean;

  /**
   * Flags that should be treated as booleans
   */
  boolean?: string[];

  /**
   * Flags that should be treated as strings
   */
  string?: string[];

  /**
   * Flags that accumulate multiple values into arrays
   */
  array?: string[];

  /**
   * Alias mappings (short to long flag names)
   */
  alias?: Record<string, string | string[]>;

  /**
   * Default values for flags
   */
  default?: Record<string, any>;
}

export interface ParseResult {
  /**
   * Parsed flags as key-value pairs
   */
  [key: string]: any;

  /**
   * Positional arguments
   */
  _: string[];
}

export interface PromptOptions {
  /**
   * The message to display to the user
   */
  message: string;

  /**
   * Default value if user provides no input
   */
  default?: string;

  /**
   * Validation function that returns true if valid, or an error message
   */
  validate?: (input: string) => boolean | string;

  /**
   * Transform the input before returning
   */
  transform?: (input: string) => any;

  /**
   * Fallback value for non-TTY environments
   */
  fallback?: () => string;
}

export interface SelectOptions {
  /**
   * The message to display
   */
  message: string;

  /**
   * Available choices
   */
  choices: string[];

  /**
   * Default selected index
   */
  default?: number;

  /**
   * Maximum items to display at once
   */
  maxVisible?: number;

  /**
   * Fallback for non-TTY
   */
  fallback?: () => string;
}

export interface ConfirmOptions {
  /**
   * The question to ask
   */
  message: string;

  /**
   * Default value
   */
  default?: boolean;

  /**
   * Fallback for non-TTY
   */
  fallback?: () => boolean;
}

export interface MultiSelectOptions {
  /**
   * The message to display
   */
  message: string;

  /**
   * Available choices
   */
  choices: string[];

  /**
   * Maximum items to display at once
   */
  maxVisible?: number;

  /**
   * Minimum number of selections required
   */
  min?: number;

  /**
   * Maximum number of selections allowed
   */
  max?: number;

  /**
   * Fallback for non-TTY
   */
  fallback?: () => string[];
}

export interface CLISchema {
  /**
   * CLI application name
   */
  name?: string;

  /**
   * CLI version
   */
  version?: string;

  /**
   * CLI description
   */
  description?: string;

  /**
   * Flag definitions
   */
  flags?: Record<string, FlagDefinition>;

  /**
   * Subcommand definitions
   */
  commands?: Record<string, CommandDefinition>;

  /**
   * Performance hints
   */
  hints?: {
    maxArgs?: number;
    commonFlags?: string[];
    lazyInteractive?: boolean;
  };
}

export interface FlagDefinition {
  type: "string" | "number" | "boolean" | "array" | "enum";
  short?: string;
  description?: string;
  default?: any;
  required?: boolean;
  env?: string;
  validate?: (value: any) => boolean | string;
  transform?: (value: any) => any;
  // For enums
  choices?: string[];
  // For arrays
  of?: "string" | "number";
  separator?: string;
  accumulate?: boolean;
}

export interface CommandDefinition {
  description?: string;
  flags?: Record<string, FlagDefinition>;
  handler?: (args: ParseResult) => void | Promise<void>;
  subcommands?: Record<string, CommandDefinition>;
}

class CLI {
  private schema: CLISchema;

  constructor(schema?: CLISchema) {
    this.schema = schema || {};
  }

  /**
   * Parse command-line arguments
   */
  parse(args?: string[], options?: ParseOptions): ParseResult {
    // For now, return a placeholder until native implementation is connected
    return { _: args || [] };
  }

  /**
   * Simple parsing with minimal options
   */
  parseSimple(args?: string[]): ParseResult {
    // For now, return a placeholder until native implementation is connected
    return { _: args || [] };
  }

  /**
   * Check if running in TTY
   */
  get isTTY(): boolean {
    // Placeholder - will be connected to native implementation
    return process.stdout?.isTTY || false;
  }

  /**
   * Interactive prompts
   */
  get prompt() {
    return {
      text: (options: PromptOptions): Promise<string> => {
        if (!this.isTTY && options.fallback) {
          return Promise.resolve(options.fallback());
        }
        // Placeholder implementation
        return Promise.resolve(options.default || "");
      },

      confirm: async (options: ConfirmOptions): Promise<boolean> => {
        if (!this.isTTY && options.fallback) {
          return options.fallback();
        }

        // Placeholder implementation
        return options.default !== undefined ? options.default : false;
      },

      select: async (options: SelectOptions): Promise<string> => {
        if (!this.isTTY && options.fallback) {
          return options.fallback();
        }

        // Placeholder implementation
        return options.choices[options.default || 0] || options.choices[0];
      },

      multiselect: async (options: MultiSelectOptions): Promise<string[]> => {
        if (!this.isTTY && options.fallback) {
          return options.fallback();
        }

        // TODO: Implement proper multiselect
        throw new Error("Multiselect not yet implemented");
      },

      form: async (fields: Record<string, any>): Promise<any> => {
        const result: any = {};

        for (const [key, field] of Object.entries(fields)) {
          if (field.type === "text") {
            result[key] = await this.prompt.text(field);
          } else if (field.type === "confirm") {
            result[key] = await this.prompt.confirm(field);
          } else if (field.type === "select") {
            result[key] = await this.prompt.select(field);
          }
        }

        return result as T;
      },
    };
  }

  /**
   * Run CLI with subcommands
   */
  async run(args?: string[]): Promise<void> {
    const parsed = this.parse(args);

    if (this.schema.commands) {
      const commandName = parsed._[0];
      const command = this.schema.commands[commandName];

      if (command && command.handler) {
        // Remove command name from positional args
        parsed._.shift();
        await command.handler(parsed);
      } else {
        this.showHelp();
      }
    }
  }

  /**
   * Show help message
   */
  showHelp(): void {
    const { name = "cli", version, description, flags, commands } = this.schema;

    console.log(`${name}${version ? ` v${version}` : ""}`);
    if (description) console.log(`\n${description}`);

    if (flags && Object.keys(flags).length > 0) {
      console.log("\nOptions:");
      for (const [key, flag] of Object.entries(flags)) {
        const short = flag.short ? `-${flag.short}, ` : "    ";
        const desc = flag.description || "";
        const def = flag.default !== undefined ? ` (default: ${flag.default})` : "";
        console.log(`  ${short}--${key.padEnd(20)} ${desc}${def}`);
      }
    }

    if (commands && Object.keys(commands).length > 0) {
      console.log("\nCommands:");
      for (const [name, cmd] of Object.entries(commands)) {
        const desc = cmd.description || "";
        console.log(`  ${name.padEnd(20)} ${desc}`);
      }
    }
  }

  private mergeOptions(options?: ParseOptions): ParseOptions {
    const result: ParseOptions = {
      stopEarly: options?.stopEarly ?? false,
      allowUnknown: options?.allowUnknown ?? true,
      autoType: options?.autoType ?? true,
    };

    // Extract flag types from schema
    if (this.schema.flags) {
      const boolean: string[] = [];
      const string: string[] = [];
      const array: string[] = [];
      const alias: Record<string, string> = {};

      for (const [key, flag] of Object.entries(this.schema.flags)) {
        if (flag.type === "boolean") boolean.push(key);
        if (flag.type === "string") string.push(key);
        if (flag.type === "array") array.push(key);
        if (flag.short) alias[flag.short] = key;
      }

      result.boolean = [...(options?.boolean || []), ...boolean];
      result.string = [...(options?.string || []), ...string];
      result.array = [...(options?.array || []), ...array];
      result.alias = { ...alias, ...options?.alias };
    }

    return result;
  }
}

// Create singleton instance
const defaultCLI = new CLI();

// Export as default with all methods
export default {
  create(schema?: CLISchema): CLI {
    return new CLI(schema);
  },

  parse(args?: string[], options?: ParseOptions): ParseResult {
    return defaultCLI.parse(args, options);
  },

  parseSimple(args?: string[]): ParseResult {
    return defaultCLI.parseSimple(args);
  },

  prompt: defaultCLI.prompt,

  get isTTY(): boolean {
    return defaultCLI.isTTY;
  },
};